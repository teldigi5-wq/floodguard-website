export default function Loading(){
  // Route loading must never cover the whole monitoring UI indefinitely.
  // The FloodProvider owns connection/freshness state and renders partial data.
  return null;
}
