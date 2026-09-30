/** Escapes the characters that have a meaning inside a WIFI: QR payload. */
const esc = (v: string) => v.replace(/([\\;,:"])/g, "\\$1");

/**
 * The text of a QR code that phones recognise as "join this Wi-Fi network"
 * (https://github.com/zxing/zxing/wiki/Barcode-Contents#wi-fi-network-config-android-ios-11). An empty password
 * means an open network.
 */
export function wifiQrPayload(ssid: string, password: string): string {
  return password ? `WIFI:T:WPA;S:${esc(ssid)};P:${esc(password)};;` : `WIFI:T:nopass;S:${esc(ssid)};;`;
}
