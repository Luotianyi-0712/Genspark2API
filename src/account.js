import config from "./config.js"
import fs from 'fs'

class AccountManager {
  constructor() {
    this.accounts = []
    this.index = 0
  }

  init(accounts = []) {

    if (!accounts || !accounts.length) {
      console.log("账号初始化失败，没有读取到账号")
      return false
    }
    this.accounts.push(...accounts)
    console.log("账号初始化成功：", this.accounts.length, " 个")
    console.log(this.accounts)
    return true
  }

  addAccount(account) {
    this.accounts.push(account.replace("\r", "").replace("\n", ""))
    if (config.account.mode == "2") {
      fs.appendFileSync(config.account.path, account + "\n")
    }
    console.log("账号添加成功：", account)
    console.log(this.accounts)
  }

  getAccount() {
    const account = this.accounts[this.index]
    this.index++
    if (this.index >= this.accounts.length) {
      this.index = 0
    }
    return account
  }

  getAccountAll() {
    return this.accounts
  }

}

const accountManager = new AccountManager()

export default accountManager