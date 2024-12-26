import 'dotenv/config'
import express from 'express'
import bodyParser from 'body-parser'
import crypto from 'crypto'
import { models, imageModels } from './models.js'
import AccountManager from './account.js'
import config from './config.js'
import fs from 'fs'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'

const app = express()

// 使用 bodyParser 中间件
app.use(bodyParser.json({ limit: '30mb' }))
app.use(bodyParser.urlencoded({ extended: true, limit: '30mb' }))
app.use(bodyParser.text({ limit: '30mb' }))

// ----------------------------------------------------------------------------------------------------
// 初始化账号管理器
let accountInitStatus = null
const accounts = []

if (config.account.mode == "1") {
  accounts.push(...config.account.accounts.split(',').filter(Boolean))
} else if (config.account.mode == "2") {
  const accountsFromFile = fs.readFileSync(config.account.path, 'utf-8').split('\n').filter(Boolean)
  accounts.push(...accountsFromFile.map(item => item.replace("\r", "").replace("\n", "")))
} else if (config.account.mode == "3") {
  const accountsFromFile = fs.readFileSync(config.account.path, 'utf-8').split('\n').filter(Boolean)
  accounts.push(...accountsFromFile.map(item => item.replace("\r", "").replace("\n", "")), ...config.account.accounts.split(',').filter(Boolean))
}

accountInitStatus = AccountManager.init(accounts)

let proxyAgent = null

// 代理配置
if (config.proxy.mode == "1") {
  if (config.proxy.url.includes("http")) {
    // http://${proxyUsername}:${proxyPassword}@${proxyHost}:${proxyPort}
    proxyAgent = new HttpsProxyAgent(config.proxy.url)
  } else if (config.proxy.url.includes("socks5")) {
    // socks5://${proxyUsername}:${proxyPassword}@${proxyHost}:${proxyPort}
    proxyAgent = new SocksProxyAgent(config.proxy.url)
  }
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

const sleep = async (ms) => {
  return await new Promise(resolve => setTimeout(resolve, ms))
}

const getImageUrl = async (session_id, task_id) => {
  const myHeaders = {
    "Cookie": `session_id=${session_id}`,
    "User-Agent": "Apifox/1.0.0 (https://apifox.com)",
    "Content-Type": "application/json",
    "Accept": "*/*",
    "Host": "www.genspark.ai",
    "Connection": "keep-alive"
  }

  const reqConfig = {
    method: 'GET',
    headers: myHeaders,
    redirect: 'follow',
    agent: proxyAgent
  }
  const startTime = Date.now()
  while (true) {
    try {
      const url = await fetch(`https://www.genspark.ai/api/spark/image_generation_task_status?task_id=${task_id}`, reqConfig)
      const urlContent = await url.json()
      // console.log(3, urlContent.data.status)
      if (urlContent.data.status == "SUCCESS") {
        return urlContent.data.image_urls_nowatermark[0]
      } else {
        if (Date.now() - startTime > config.imageWaitTime || urlContent.data.status == "FAILURE") {
          return null
        }
        await sleep(1000)
      }
    } catch (e) {
      return null
    }
  }

}

const SendImageRequest = async (session_id, content, model = "dall-e-3", size = "1:1", style = "auto") => {
  const myHeaders = {
    "Cookie": `session_id=${session_id}`,
    "User-Agent": "Apifox/1.0.0 (https://apifox.com)",
    "Content-Type": "application/json",
    "Accept": "*/*",
    "Host": "www.genspark.ai",
    "Connection": "keep-alive"
  }

  const sizeArray = ["auto", "9:16", "2:3", "3:4", "1:1", "4:3", "3:2", "16:9"]
  /* 
  auto: 自动
  realistic_image: 写实
  cartoon: 卡通
  watercolor: 水彩
  anime: 动漫
  oil_painting: 油画
  3d: 3D
  minimalist: 极简
  pop_art: 波普艺术
  */
  const styleArray = ["auto", "realistic_image", "cartoon", "watercolor", "anime", "oil_painting", "3d", "minimalist", "pop_art"]

  size = sizeArray.includes(size) ? size : "auto"
  style = styleArray.includes(style) ? style : "auto"

  const body = JSON.stringify({
    "type": "COPILOT_MOA_IMAGE",
    "current_query_string": "type=COPILOT_MOA_IMAGE",
    "messages": [
      {
        "role": "user",
        "content": content
      }
    ],
    "action_params": {},
    "extra_data": {
      "model_configs": [
        {
          "model": imageModels[model] || imageModels["dall-e-3"],
          "aspect_ratio": size,
          "use_personalized_models": false,
          "fashion_profile_id": null,
          "hd": false,
          "reflection_enabled": false,
          "style": style
        }
      ],
      "imageModelMap": {},
      "writingContent": null
    }
  })

  const requestConfig = {
    method: 'POST',
    headers: myHeaders,
    body: body,
    redirect: 'follow',
    agent: proxyAgent
  }

  const imageResponse = await fetch("https://www.genspark.ai/api/copilot/ask", requestConfig)

  const imageStream = imageResponse.body.getReader()
  const imageTaskIDs = []

  while (true) {
    const { done, value } = await imageStream.read()
    if (done) {
      break
    }

    const text = new TextDecoder().decode(value)
    const textContent = [...text.matchAll(/data:.*"}/g)]
    for (const item of textContent) {
      if (!item[0] || !isValidJSON(item[0].replace("data: ", ''))) {
        continue
      }
      let content = JSON.parse(item[0].replace("data: ", ''))
      if (content.type != 'message_result') {
        continue
      }
      const urlIDs = JSON.parse(content.content).generated_images.map(item => item.task_id)
      imageTaskIDs.push(...urlIDs)
    }
  }

  // console.log(1,imageTaskIDs)

  if (imageTaskIDs.length > 0) {
    const imageUrls = []
    for (const item of imageTaskIDs) {
      const url = await getImageUrl(session_id, item)
      // console.log(2, url)
      if (url) {
        imageUrls.push(url)
      }
      if (imageUrls.length >= config.imageCount) {
        break
      }
    }
    return imageUrls
  } else {
    return []
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
      redirect: 'follow',
      agent: proxyAgent
    };

    return await fetch("https://www.genspark.ai/api/copilot/ask", requestConfig)
  } catch (error) {
    console.log('error1', error)
    throw error
  }
}

const searchModel = async (session_id, messages) => {
  try {

    const content = messages[messages.length - 1].content
    const query = doubleEncode(content)

    const myHeaders = {
      "Cookie": `session_id=${session_id}`,
      "User-Agent": "Apifox/1.0.0 (https://apifox.com)",
      "Content-Type": "application/json",
      "Accept": "*/*",
      "Host": "www.genspark.ai",
      "Connection": "keep-alive",
    }

    return await fetch(`https://www.genspark.ai/api/search/stream?query=${query}`, {
      method: 'POST',
      headers: myHeaders,
      redirect: 'follow',
      agent: proxyAgent
    })

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
      redirect: 'follow',
      agent: proxyAgent
    }

    return await fetch(`https://www.genspark.ai/api/project/delete?project_id=${project_id}`, requestConfig)
  } catch (error) {
    console.log('error3', error)
    return false
  }
}

app.post(config.apiPath + '/v1/chat/completions', async (req, res) => {
  const { messages, stream = false, model = 'claude-3-5-sonnet-20241022' } = req.body
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
    const messageId = crypto.randomUUID()

    if (stream === "true" || stream === true) {
      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      })
    } else {
      res.set({
        'Content-Type': 'application/json',
      })
    }

    if (model === "genspark") {
      const searchResponse = await searchModel(session_id, messages)
      if (!searchResponse) {
        return res.status(500).json({ error: '请求失败' })
      }

      let searchResult = ''

      const reader = searchResponse.body.getReader()

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        const text = new TextDecoder().decode(value)

        let contentArray = [...text.matchAll(/data:.*"}/g)]
        for (const item of contentArray) {
          if (!item[0] || !isValidJSON(item[0].replace("data: ", ''))) {
            console.log("不符合", item[0])
            continue
          }
          let content = JSON.parse(item[0].replace("data: ", ''))
          if (content.delta) {
            console.log(content.delta)
          }
        }


      }

      return

    } else if (imageModels[model]) {
      // console.log(session_id, messages[messages.length - 1].content, model)

      const imageUrls = await SendImageRequest(session_id, messages[messages.length - 1].content, model)
      console.log(imageUrls)
      if (imageUrls.length == 0) {
        return res.status(500).json({ error: '请求失败' })
      }

      let imageUrlsContent = ''
      imageUrls.forEach(item => {
        imageUrlsContent += `![image](${item})\n`
      })

      if (stream === "true" || stream === true) {

        res.write(`data: ${JSON.stringify({
          "id": `chatcmpl-${messageId}`,
          "choices": [
            {
              "index": 0,
              "delta": {
                "content": imageUrlsContent
              }
            }
          ],
          "created": Math.floor(Date.now() / 1000),
          "model": models[`${model}`],
          "object": "chat.completion.chunk"
        })}\n\n`)
        res.write('data: [DONE]\n\n')
        return
      } else {

        res.json({
          id: `chatcmpl-${messageId}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: imageUrlsContent,
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: imageUrlsContent.length,
          },
        })
      }

      return

    } else {
      response = await makeRequest(session_id, model, messages)
      if (!response) {
        return res.status(500).json({ error: '请求失败' })
      }
    }

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
            if (!item[0] || !isValidJSON(item[0].replace("data: ", ''))) {
              return
            }

            const content = JSON.parse(item[0].replace("data: ", ''))

            if (content.type === 'project_start' && content.id) {
              project_id = content.id
            }

            if (!content || !content?.field_value || content?.field_name === 'session_state.answer_is_finished' || content?.field_name === 'content' || content?.field_name === 'session_state' || content?.delta || content?.type === 'project_field') {
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

app.post(config.apiPath + '/v1/images/generations', async (req, res) => {
  const { prompt, n = 1, size = "1:1", model = "dall-e-3" } = req.body
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
  const imageUrls = await SendImageRequest(session_id, prompt, model, "1:1", "auto")
  res.json({
    created: Math.floor(Date.now() / 1000),
    data: imageUrls.map(item => {
      return {
        url: item
      }
    })
  })
})

// 获取 models
app.get(config.apiPath + '/v1/models', (req, res) => {
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

app.get(config.apiPath + '/status', (req, res) => {
  res.json({
    status: true,
    message: 'Genspark2API is running'
  })
})

app.post(config.apiPath + '/account/add', async (req, res) => {
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