/*
 * FloodGuard R2 — HOST-ONLY upstream LittleFS 2.5.0 exclusivity witness.
 * The exact upstream sources are SHA-pinned by CI at Arduino core 3.1.2's
 * LittleFS submodule commit. This is NOT ESP8266 flash or an MCU writer.
 * This test does not mount hardware, send telemetry, ACK or operate gates.
 */
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "lfs.h"

enum { FG_BLOCK_SIZE = 512, FG_BLOCK_COUNT = 64, FG_IO_SIZE = 16 };
struct MemoryFlash {
    uint8_t bytes[FG_BLOCK_COUNT][FG_BLOCK_SIZE];
    unsigned int program_calls;
    unsigned int erase_calls;
    int fail_read_once;
};
static struct MemoryFlash disk;

static int valid_region(lfs_block_t block, lfs_off_t off, lfs_size_t size) {
    return block < FG_BLOCK_COUNT &&
        off <= FG_BLOCK_SIZE && size <= FG_BLOCK_SIZE - off &&
        (off % FG_IO_SIZE) == 0 && (size % FG_IO_SIZE) == 0;
}
static int disk_read(const struct lfs_config *cfg,
        lfs_block_t block, lfs_off_t off, void *target, lfs_size_t size) {
    struct MemoryFlash *m = (struct MemoryFlash *)cfg->context;
    if (!valid_region(block, off, size)) return LFS_ERR_IO;
    if (m->fail_read_once) {
        m->fail_read_once = 0;
        return LFS_ERR_IO;
    }
    memcpy(target, &m->bytes[block][off], size);
    return 0;
}
static int disk_prog(const struct lfs_config *cfg,
        lfs_block_t block, lfs_off_t off, const void *source, lfs_size_t size) {
    struct MemoryFlash *m = (struct MemoryFlash *)cfg->context;
    const uint8_t *src = (const uint8_t *)source;
    if (!valid_region(block, off, size)) return LFS_ERR_IO;
    // Model NOR: programming may only transition a bit from 1 to 0.
    for (lfs_size_t i = 0; i < size; i++) {
        if ((m->bytes[block][off+i] & src[i]) != src[i]) return LFS_ERR_IO;
    }
    for (lfs_size_t i = 0; i < size; i++)
        m->bytes[block][off+i] &= src[i];
    ++m->program_calls;
    return 0;
}
static int disk_erase(const struct lfs_config *cfg, lfs_block_t block) {
    struct MemoryFlash *m = (struct MemoryFlash *)cfg->context;
    if (block >= FG_BLOCK_COUNT) return LFS_ERR_IO;
    memset(m->bytes[block], 0xff, FG_BLOCK_SIZE);
    ++m->erase_calls;
    return 0;
}
static int disk_sync(const struct lfs_config *cfg) {
    (void)cfg;
    return 0;
}
static const struct lfs_config config = {
    .context = &disk,
    .read = disk_read,
    .prog = disk_prog,
    .erase = disk_erase,
    .sync = disk_sync,
    .read_size = FG_IO_SIZE,
    .prog_size = FG_IO_SIZE,
    .block_size = FG_BLOCK_SIZE,
    .block_count = FG_BLOCK_COUNT,
    .block_cycles = 100,
    .cache_size = 64,
    .lookahead_size = 16,
};
static const char payload[] =
    "opaque journal fixture; not device-authenticated and not cloud-confirmed";
static const char *const target = "/fgq2_0.bin";
static const char *phase = "unknown";

static void expect_original(lfs_t *fs) {
    lfs_file_t f = {0};
    char buf[sizeof(payload)] = {0};
    const int opened = lfs_file_open(fs, &f, target, LFS_O_RDONLY);
    if (opened != 0) fprintf(stderr, "read-back open failed: phase=%s code=%d\\n", phase, opened);
    assert(opened == 0);
    assert(lfs_file_read(fs, &f, buf, sizeof(payload)) ==
           (lfs_ssize_t)sizeof(payload));
    assert(memcmp(buf, payload, sizeof(payload)) == 0);
    assert(lfs_file_close(fs, &f) == 0);
}
static void expect_exclusive_refusal(lfs_t *fs) {
    lfs_file_t duplicate = {0};
    const unsigned int writes = disk.program_calls;
    const unsigned int erases = disk.erase_calls;
    const int result = lfs_file_open(fs, &duplicate, target,
                                    LFS_O_WRONLY | LFS_O_CREAT | LFS_O_EXCL);
    // No close after failed open; the duplicate must not become a file handle.
    assert(result == LFS_ERR_EXIST);
    assert(disk.program_calls == writes);
    assert(disk.erase_calls == erases);
    expect_original(fs);
}
int main(void) {
    // A disposable, memory-only block device; no physical flash.
    memset(&disk, 0, sizeof(disk));
    memset(disk.bytes, 0xff, sizeof(disk.bytes));
    lfs_t fs = {0};
    assert(lfs_format(&fs, &config) == 0);
    assert(lfs_mount(&fs, &config) == 0);

    lfs_file_t first = {0};
    assert(lfs_file_open(&fs, &first, target,
            LFS_O_WRONLY | LFS_O_CREAT | LFS_O_EXCL) == 0);
    assert(lfs_file_write(&fs, &first, payload, sizeof(payload)) ==
           (lfs_ssize_t)sizeof(payload));
    assert(lfs_file_sync(&fs, &first) == 0);
    assert(lfs_file_close(&fs, &first) == 0);
    phase = "initial commit";
    expect_original(&fs);
    phase = "initial duplicate";
    expect_exclusive_refusal(&fs);

    // A normal remount is a host restart simulation, not a brownout proof.
    assert(lfs_unmount(&fs) == 0);
    memset(&fs, 0, sizeof(fs));
    assert(lfs_mount(&fs, &config) == 0);
    phase = "remounted duplicate";
    expect_exclusive_refusal(&fs);

    // A block-device read error must never authorize create-over-existing.
    disk.fail_read_once = 1;
    lfs_file_t fault = {0};
    int result = lfs_file_open(&fs, &fault, target,
                              LFS_O_WRONLY | LFS_O_CREAT | LFS_O_EXCL);
    assert(result < 0);
    // Quarantine the entire mounted instance: after a transient read fault,
    // the same session may return ENOENT for a retained slot. Never convert
    // that to permission to create or append a record.
    assert(disk.fail_read_once == 0);
    assert(lfs_unmount(&fs) == 0);
    memset(&fs, 0, sizeof(fs));
    assert(lfs_mount(&fs, &config) == 0);
    phase = "fresh remount after read fault";
    expect_original(&fs);
    expect_exclusive_refusal(&fs);
    assert(lfs_unmount(&fs) == 0);

    puts("PASS pinned upstream LittleFS O_EXCL: no overwrite, remount, fail-closed read fault (HOST ONLY)");
    return 0;
}
