import 'dotenv/config'
import express from 'express'
import bodyParser from 'body-parser'
import crypto from 'crypto'
import models from './models.js'
import AccountManager from './account.js'
import config from './config.js'
import fs from 'fs'

const app = express()

// 使用 bodyParser 中间件
app.use(bodyParser.json({ limit: '30mb' }))
app.use(bodyParser.urlencoded({ extended: true, limit: '30mb' }))
app.use(bodyParser.text({ limit: '30mb' }))

// ----------------------------------------------------------------------------------------------------
// 初始化账号管理器
let accountInitStatus = null

if (config.account.mode == "1") {
  accountInitStatus = AccountManager.init(config.account.accounts.split(',').filter(Boolean))
} else if (config.account.mode == "2") {
  const accounts = fs.readFileSync(config.account.path, 'utf-8').split('\n').filter(Boolean)
  accountInitStatus = AccountManager.init(accounts.map(item => item.replace("\r", "").replace("\n", "")))
} else {
  accountInitStatus = false
}



















// ----------------------------------------------------------------------------------------------------

function doubleEncode(str) {
  return encodeURIComponent(encodeURIComponent(str))
}

function isValidJSON(str) {
  try {
    JSON.parse(str)
    return true
  } catch (e) {
    return false
  }
}

const makeRequest = async (session_id, requestModel, messages) => {
  try {
    console.log("发送请求：", session_id)

    const myHeaders = {
      "Cookie": `session_id=${session_id}`,
      "User-Agent": "Apifox/1.0.0 (https://apifox.com)",
      "Content-Type": "application/json",
      "Accept": "*/*",
      "Host": "www.genspark.ai",
      "Connection": "keep-alive"
    }

    const body = JSON.stringify({
      "type": "COPILOT_MOA_CHAT",
      "current_query_string": "type=COPILOT_MOA_CHAT",
      "messages": messages,
      "action_params": {},
      "extra_data": {
        "models": [
          models[requestModel] || models["claude-3-5-sonnet-20241022"]
        ],
        "run_with_another_model": false,
        "writingContent": null
      }
    })

    const requestConfig = {
      method: 'POST',
      headers: myHeaders,
      body: body,
      redirect: 'follow'
    };

    return await fetch("https://www.genspark.ai/api/copilot/ask", requestConfig)
  } catch (error) {
    console.log('error1', error)
    throw error
  }
}

const searchModel = async (session_id, messages) => {
  try {

    const myHeaders = {
      "Cookie": `session_id=${session_id}`,
      "User-Agent": "Apifox/1.0.0 (https://apifox.com)",
      "Content-Type": "application/json",
      "Accept": "*/*",
      "Host": "www.genspark.ai",
      "Connection": "keep-alive"
    }

    const content = messages[messages.length - 1].content
    const query = doubleEncode(content)

    const requestConfig = {
      method: 'POST',
      headers: myHeaders,
      redirect: 'follow'
    }

    return await fetch(`https://www.genspark.ai/api/search/stream?query=${query}`, requestConfig)

  } catch (error) {
    console.log('error2', error)
    return false
  }
}

const deleteMessage = async (project_id, session_id) => {
  try {
    const myHeaders = {
      "Cookie": `session_id=${session_id}`,
      "User-Agent": "Apifox/1.0.0 (https://apifox.com)",
      "Content-Type": "application/json",
      "Accept": "*/*",
      "Host": "www.genspark.ai",
      "Connection": "keep-alive"
    }

    const requestConfig = {
      method: 'GET',
      headers: myHeaders,
      redirect: 'follow'
    }

    return await fetch(`https://www.genspark.ai/api/project/delete?project_id=${project_id}`, requestConfig)
  } catch (error) {
    console.log('error3', error)
    return false
  }
}

app.post('/v1/chat/completions', async (req, res) => {
  const { messages, stream = false, model = 'claude-3-5-sonnet' } = req.body
  const authHeader = req.headers['authorization'] || ''
  let session_id = authHeader.replace('Bearer ', '')

  if (!session_id) {
    return res.status(401).json({ error: '未提供有效的 session_id 或 apiKey' })
  }

  if (accountInitStatus) {
    if (config.apiKey && config.apiKey == session_id) {
      session_id = AccountManager.getAccount()
    }
  }

  try {

    let response = null
    let project_id = null
    if (model === "genspark") {
      response = await searchModel(session_id, messages)
    } else {
      response = await makeRequest(session_id, model, messages)
    }

    if (stream === "true" || stream === true) {
      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
    } else {
      res.set({
        'Content-Type': 'application/json',
      });
    }

    const messageId = crypto.randomUUID()
    const reader = response.body.getReader()

    try {
      let resBody = {}

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          if (stream === "true" || stream === true) {
            res.write('data: [DONE]\n\n')
          }
          break
        }

        if (stream) {
          const text = new TextDecoder().decode(value)
          const textContent = [...text.matchAll(/data:.*"}/g)]

          textContent.forEach(item => {

            let content = item[0].replace("data: ", '')
            if (!item[0] || !isValidJSON(content)) {
              return
            }
            content = JSON.parse(content)

            if (content.type == 'project_start' && content.id) {
              project_id = content.id
            }

            // console.log(content)

            if (!content || !content.delta) {
              return
            }

            res.write(`data: ${JSON.stringify({
              "id": `chatcmpl-${messageId}`,
              "choices": [
                {
                  "index": 0,
                  "delta": {
                    "content": content.delta
                  }
                }
              ],
              "created": Math.floor(Date.now() / 1000),
              "model": models[`${model}`],
              "object": "chat.completion.chunk"
            })}\n\n`)

          })
        } else {
          const text = new TextDecoder().decode(value)
          const textContent = [...text.matchAll(/data:.*"}/g)]

          textContent.forEach(item => {
            if (!item[0]) {
              return
            }

            const content = JSON.parse(item[0].replace("data: ", ''))

            if (content.type === 'project_start' && content.id) {
              project_id = content.id
            }

            if (!content || !content.field_value || content.field_name === 'session_state.answer_is_finished' || content.field_name === 'content' || content.field_name === 'session_state' || content.delta || content.type === 'project_field') {
              return
            }

            resBody = {
              id: `chatcmpl-${messageId}`,
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: content.field_value,
                  },
                  finish_reason: 'stop',
                },
              ],
              usage: {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: content.field_value.length,
              },
            }

          })
        }
      }

      if (stream === "false" || stream === false) {
        res.json(resBody)
      } else {
        res.end()
      }

      if (project_id) {
        // console.log('deleteMessage', project_id, session_id)
        await deleteMessage(project_id, session_id)
      }

      return

    } catch (error) {
      console.error('流式响应出错:', error)
      res.end()
    }

  } catch (error) {
    console.error('请求处理出错:', error)
    res.status(500).json({ error: '请求处理失败' })
  }
})

// 获取 models
app.get('/v1/models', (req, res) => {
  res.json({
    object: "list",
    data: Object.keys(models).map(model => ({
      id: model,
      object: "model",
      created: 1706745938,
      owned_by: "genspark"
    }))
  })
})

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('全局错误:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message
  })
})

app.get('/status', (req, res) => {
  res.json({
    status: true,
    message: 'Genspark2API is running'
  })
})

app.post('/api/account/add', async (req, res) => {
  const authHeader = req.headers['authorization'] || ''
  let apiKey = authHeader.replace('Bearer ', '')
  if (apiKey != config.apiKey) {
    return res.status(401).json({ error: '未提供有效的 apiKey' })
  }

  if (accountInitStatus && config.account.mode == "2") {
    const account = req.body.account
    AccountManager.addAccount(account)
    res.json({
      status: true,
      message: '账号添加成功!'
    })
  }
})

// 启动服务器
app.listen(config.port, () => {
  console.log(`服务器运行在 http://localhost:${config.port}`)
})