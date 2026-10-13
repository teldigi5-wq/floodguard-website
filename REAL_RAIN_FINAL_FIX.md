# Real rain final compatibility
- Rainfall page now uses the installed collector-depth sensor.
- Added waterDepthCm/rawValue/calibrationLimited/sensorStatus schema fields.
- weightGrams remains nullable and displays Unavailable.
- Legacy rain.status=ONLINE is normalized from real dailyMm only.
- No synthetic history.
