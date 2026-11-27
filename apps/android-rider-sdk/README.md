# HearMe rider SDK (Android, Kotlin)

Turns a delivery or shared-bike rider's **existing Android phone** into a HearMe v1.1 beacon — zero
extra hardware. `hearme-rider` is a small library; `sample` is a one-button rider app that uses it.

- `HearMeCodec` — Kotlin port of the reference encoder (`protocol/python/hearme_protocol.py`):
  packet body, legacy advertising data (<= 31 bytes), rolling ID, 4-byte HMAC, v1.1 scan response.
- `HearMeBeacon` — `BluetoothLeAdvertiser.startAdvertisingSet` with legacy, non-connectable,
  **scannable** advertising (~100 ms, `TX_POWER_HIGH`), manufacturer data `0xFFFF` and the HearMe
  service UUID in the scan response. Call `update(location)` with each GPS fix (speed, bearing,
  position, rolling ID are rebuilt). Run it from a foreground service in a real rider app.

```kotlin
val beacon = HearMeBeacon(context, type = "e_bike", fleetKey = fleetKeyFromOperator)
beacon.start()
// for each Location from the rider app's existing location updates:
beacon.update(location)
beacon.stop()
```

## Build and test

Requires JDK 17+ and the Android SDK (path in `local.properties`, use forward slashes).

```
./gradlew :hearme-rider:testDebugUnitTest   # encoder vs protocol/test_vectors.json (4 tests)
./gradlew :sample:assembleDebug             # sample/build/outputs/apk/debug/sample-debug.apk
```

Status: compiles and passes the shared-vector unit tests; **not tested on a phone**. Notes: the
public test fleet key provides no security; phones advertise at about +1 dBm (`TX_POWER_HIGH`),
roughly 9 dB below the +10 dBm beacon module, which the Lab's "Delivery rider with phone beacon"
scenario models; some vendor BLE stacks restrict scannable non-connectable legacy advertising.
iPhones cannot be v1 beacons (iOS apps cannot set manufacturer data in advertisements).
