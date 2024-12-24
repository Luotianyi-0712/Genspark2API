const config = {
  port: process.env.PORT || 8666,
  account: {
    path: process.env.ACCOUNT_PATH || './data/account.txt',
    mode: process.env.ACCOUNT_MODE || "0",
    accounts: process.env.ACCOUNTS || "",
  },
  apiKey: process.env.API_KEY || "sk-123456",
}

export default config