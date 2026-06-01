export type PairedUser = {
  userId: string | number
  displayName: string
  pairedAt: number
}

export type PairingState = {
  code: string | null
  expiresAt: number | null
  createdAt: number | null
}

export type ImRuntimeDefaultConfig = {
  providerId: string | null
  modelId: string
  updatedAt?: number
}

export type AdapterFileConfig = {
  serverUrl?: string
  defaultProjectDir?: string
  imRuntimeDefault?: ImRuntimeDefaultConfig
  pairing?: PairingState
  telegram?: {
    botToken?: string
    allowedUsers?: number[]
    pairedUsers?: PairedUser[]
    defaultWorkDir?: string
  }
  feishu?: {
    appId?: string
    appSecret?: string
    encryptKey?: string
    verificationToken?: string
    allowedUsers?: string[]
    pairedUsers?: PairedUser[]
    defaultWorkDir?: string
    streamingCard?: boolean
  }
  wechat?: {
    accountId?: string
    botToken?: string
    baseUrl?: string
    userId?: string
    allowedUsers?: string[]
    pairedUsers?: PairedUser[]
    defaultWorkDir?: string
  }
  dingtalk?: {
    clientId?: string
    clientSecret?: string
    allowedUsers?: string[]
    pairedUsers?: PairedUser[]
    defaultWorkDir?: string
    endpoint?: string
    permissionCardTemplateId?: string
  }
}
