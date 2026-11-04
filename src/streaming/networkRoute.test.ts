import { describe, expect, it } from 'vitest'
import { networkRouteOf } from './networkRoute'

// Each row starts from the address bar, so the classifier sees the hostname exactly as the
// browser's URL parser hands it to location.hostname.
function hostnameOf(address: string): string {
  return new URL(address).hostname
}

describe('networkRouteOf', () => {
  it.each([
    { address: 'http://10.0.0.5:8080/', reason: 'RFC 1918 10.0.0.0/8' },
    { address: 'http://10.255.255.255/', reason: 'the top of 10.0.0.0/8' },
    { address: 'http://172.16.0.1/', reason: 'the bottom of RFC 1918 172.16.0.0/12' },
    { address: 'http://172.31.255.254/', reason: 'the top of 172.16.0.0/12' },
    { address: 'http://192.168.1.20:5173/', reason: 'RFC 1918 192.168.0.0/16' },
    { address: 'http://169.254.10.20/', reason: 'IPv4 link-local' },
    { address: 'http://0300.0250.1.1/', reason: 'octal that the URL parser writes as 192.168.1.1' },
    { address: 'http://[fd12:3456:789a::1]:8080/', reason: 'IPv6 unique local fd00::/8' },
    { address: 'http://[FD00::1]/', reason: 'IPv6 unique local in capitals' },
    { address: 'http://[fe80::1]/', reason: 'IPv6 link-local fe80::/10' },
    { address: 'http://[febf:ffff::1]/', reason: 'the top of fe80::/10' },
    { address: 'http://[::ffff:192.168.1.1]/', reason: 'a private IPv4 address mapped into IPv6' },
    { address: 'http://nas.local:8080/', reason: 'a .local name' },
    { address: 'http://Media-Server.LOCAL/', reason: 'a .local name in capitals' },
    { address: 'http://nas.local./', reason: 'a fully qualified .local name' },
  ])('shouldAttestLocalNetworkWhenHostIsPrivate($reason)', ({ address }) => {
    expect(networkRouteOf(hostnameOf(address))).toBe('LOCAL_NETWORK')
  })

  it.each([
    { address: 'http://localhost:5173/', reason: 'a loopback name, which a tunnel can forward' },
    { address: 'http://127.0.0.1:8080/', reason: 'IPv4 loopback' },
    { address: 'http://[::1]/', reason: 'IPv6 loopback' },
    { address: 'http://100.64.0.1/', reason: 'the bottom of carrier-grade NAT 100.64.0.0/10' },
    { address: 'http://100.101.102.103/', reason: 'a Tailscale address in 100.64.0.0/10' },
    { address: 'http://100.127.255.254/', reason: 'the top of 100.64.0.0/10' },
    { address: 'https://media.example.com/', reason: 'a public hostname' },
    {
      address: 'https://media.example.com.local.example.net/',
      reason: '.local inside a public name',
    },
    { address: 'https://my-nas.ts.net/', reason: 'a tunnel hostname' },
    { address: 'http://203.0.113.7/', reason: 'a public IPv4 address' },
    { address: 'http://172.15.255.255/', reason: 'just below 172.16.0.0/12' },
    { address: 'http://172.32.0.1/', reason: 'just above 172.16.0.0/12' },
    { address: 'http://192.169.0.1/', reason: 'just above 192.168.0.0/16' },
    { address: 'http://11.0.0.1/', reason: 'just above 10.0.0.0/8' },
    { address: 'http://[2001:db8::1]/', reason: 'a global IPv6 address' },
    { address: 'http://[fc00::1]/', reason: 'fc00::/8, outside fd00::/8' },
    { address: 'http://[fec0::1]/', reason: 'just above fe80::/10' },
    { address: 'http://[::ffff:203.0.113.7]/', reason: 'a public IPv4 address mapped into IPv6' },
    { address: 'http://local/', reason: 'a single label named local' },
    { address: 'http://nas.localdomain/', reason: 'a name that only starts like .local' },
  ])('shouldReportInternetWhenHostIsNotPrivate($reason)', ({ address }) => {
    expect(networkRouteOf(hostnameOf(address))).toBe('INTERNET')
  })
})
