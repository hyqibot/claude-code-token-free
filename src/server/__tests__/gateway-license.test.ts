import { describe, expect, test } from 'bun:test'
import { isGatewayLicenseRequired } from '../services/gatewayLicense/config.js'
import { remoteSessionStatus } from '../services/gatewayLicense/remoteClient.js'

describe('gatewayLicense config', () => {
  test('isGatewayLicenseRequired is always true (no env skip)', () => {
    const prev = process.env.CC_HAHA_RUIKE_LICENSE_SKIP
    process.env.CC_HAHA_RUIKE_LICENSE_SKIP = '1'
    expect(isGatewayLicenseRequired()).toBe(true)
    if (prev === undefined) delete process.env.CC_HAHA_RUIKE_LICENSE_SKIP
    else process.env.CC_HAHA_RUIKE_LICENSE_SKIP = prev
  })
})

describe('gatewayLicense remoteClient', () => {
  test('remoteSessionStatus marks network failures without throwing', async () => {
    const result = await remoteSessionStatus(
      { serverUrl: 'http://127.0.0.1:1', apiSecret: 'test' },
      'session-token',
    )
    expect(result.valid).toBe(false)
    expect(result.networkError).toBe(true)
  })
})

describe('gatewayLicense persisted session shape', () => {
  test('activationCode field is optional for forward compatibility', () => {
    const legacy = {
      sessionToken: 'tok',
      endtime: '2099-01-01',
      activationCodeMasked: '****1234',
      remark: null,
      verifiedAt: 1,
    }
    const withCode = { ...legacy, activationCode: 'MY-CODE-1234' }
    expect(legacy).not.toHaveProperty('activationCode')
    expect(withCode.activationCode).toBe('MY-CODE-1234')
  })
})
