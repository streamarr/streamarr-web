import type { NetworkRoute } from '../graphql/generated/graphql'

const LOCAL_SUFFIXES = ['.local', '.home.arpa']

/**
 * How the page reached the server, from the hostname in its address bar as `location.hostname`
 * gives it. A private IPv4 address (RFC 1918 or link-local), an IPv6 unique local (fd00::/8) or
 * link-local address, and a `.local` or `.home.arpa` (RFC 8375) name are the local network; every
 * other host is the internet. Loopback counts as the internet because a tunnel can forward a
 * loopback port, and so does Tailscale's unique local prefix.
 */
export function networkRouteOf(hostname: string): NetworkRoute {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix)) || isLocalAddress(host)) {
    return 'LOCAL_NETWORK'
  }
  return 'INTERNET'
}

function isLocalAddress(host: string): boolean {
  if (host.startsWith('[') && host.endsWith(']')) return isLocalIpv6(host.slice(1, -1))
  const octets = ipv4Octets(host)
  return octets !== null && isLocalIpv4(octets)
}

function ipv4Octets(host: string): number[] | null {
  const parts = host.split('.')
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return null
  const octets = parts.map(Number)
  return octets.every((octet) => octet <= 255) ? octets : null
}

function isLocalIpv4([first, second]: readonly number[]): boolean {
  if (first === 10) return true
  if (first === 172) return second >= 16 && second <= 31
  if (first === 192) return second === 168
  if (first === 169) return second === 254
  return false
}

// The URL parser writes an IPv6 host in hex groups only, so a mapped IPv4 address arrives as two
// hex groups after ffff.
function isLocalIpv6(address: string): boolean {
  const groups = ipv6Groups(address)
  if (!groups) return false
  if (isTailscale(groups)) return false
  const [first] = groups
  if ((first & 0xff00) === 0xfd00 || (first & 0xffc0) === 0xfe80) return true
  const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff
  if (!mapped) return false
  return isLocalIpv4([groups[6] >> 8, groups[6] & 0xff])
}

// Tailscale gives its devices unique local addresses in fd7a:115c:a1e0::/48, which reach the server
// over the internet like its 100.64.0.0/10 addresses.
function isTailscale([first, second, third]: readonly number[]): boolean {
  return first === 0xfd7a && second === 0x115c && third === 0xa1e0
}

function ipv6Groups(address: string): number[] | null {
  const halves = address.split('::')
  if (halves.length > 2) return null
  const [head, tail] = halves.map((half) => (half === '' ? [] : half.split(':')))
  const missing = 8 - head.length - (tail?.length ?? 0)
  if (tail ? missing < 1 : missing !== 0) return null
  const groups = [...head, ...new Array<string>(tail ? missing : 0).fill('0'), ...(tail ?? [])]
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null
  return groups.map((group) => Number.parseInt(group, 16))
}
