// IPv4 arithmetic on plain numbers. Nothing here opens a socket or resolves a real name.

/** Parses dotted decimal strictly (four numbers 0-255, no spaces, no leading plus). Null when it is not an address. */
export function parseIpv4(text: string | undefined): number | null {
  if (typeof text !== "string") return null;
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

export function formatIpv4(value: number): string {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

/** A mask is a run of ones followed by zeros. Returns the prefix length, or null when it is not a mask. */
export function maskPrefix(text: string | undefined): number | null {
  const value = parseIpv4(text);
  if (value === null) return null;
  let prefix = 0;
  let seenZero = false;
  for (let bit = 31; bit >= 0; bit -= 1) {
    const one = Math.floor(value / 2 ** bit) % 2 === 1;
    if (one && seenZero) return null;
    if (one) prefix += 1;
    else seenZero = true;
  }
  return prefix;
}

/** The network number of `address` under a mask of `prefix` bits. */
export function networkOf(address: number, prefix: number): number {
  const size = 2 ** (32 - prefix);
  return Math.floor(address / size) * size;
}

export function sameSubnet(a: number, b: number, prefix: number): boolean {
  return networkOf(a, prefix) === networkOf(b, prefix);
}

/** `192.168.1.10/24` for evidence lines. */
export function cidr(address: string, mask: string | undefined): string {
  const prefix = maskPrefix(mask);
  return prefix === null ? address : `${address}/${prefix}`;
}

export function isIpv4Literal(text: string): boolean {
  return parseIpv4(text) !== null;
}
