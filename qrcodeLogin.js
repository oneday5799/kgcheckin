import { close_api, delay, send, startService } from "./utils/utils.js";
import { printBlue, printGreen, printMagenta, printRed, printYellow } from "./utils/colorOut.js";
import { saveUserinfo } from "./utils/baihuHelper.js";
import { maskIdentifier, sanitizeForLog, shouldPrintSensitiveValue, summarizeResponse } from "./utils/safeLog.js";

async function qrcode() {

  // 启动服务
  const api = startService()
  await delay(2000)
  let qrcode = ""
  const USERINFO = process.env.USERINFO
  const APPEND_USER = process.env.APPEND_USER
  const userinfo = (USERINFO && APPEND_USER == "是") ? JSON.parse(USERINFO) : []
  const args = process.argv.slice(2);
  const number = parseInt(process.env.NUMBER || args[0] || "1")
  try {
    for (let i = 0; i < number; i++) {
      // 二维码
      const result = await send(`/login/qr/key?timestrap=${Date.now()}`, "GET", {})
      if (result.status === 1) {
        qrcode = result.data.qrcode
        const img_base64 = result.data.qrcode_img;
        const chunkSize = 1000;
        printMagenta("二维码链接如下, 请在浏览器打开使用APP扫描并确认登录")
        for (let i = 0; i < img_base64.length; i += chunkSize) {
          console.log(img_base64.slice(i, i + chunkSize));
        }
      } else {
        printRed("响应内容")
        console.dir(summarizeResponse(result), { depth: null })
        throw new Error("请求出错")
      }
      printMagenta("正在等待，请扫描二维码并确定登录")
      // 登录
      for (let i = 0; i < 25; i++) {
        const timestrap = Date.now();
        const res = await send(`/login/qr/check?key=${qrcode}&timestrap=${timestrap}`, "GET", {})
        const status = res?.data?.status
        switch (status) {
          case 0:
            printYellow("二维码已过期")
            break

          case 1:
            // console.log("未扫描二维码")
            break

          case 2:
            // console.log("二维码未确认，请点击确认登录")
            break
          case 4:
            let userAlreadyExist = false
            printGreen("登录成功！")
            if (APPEND_USER == "是") {
              for (let i = 0; i < userinfo.length; i++) {

                if (userinfo[i].userid == res.data.userid) {
                  userAlreadyExist = true
                  printYellow(`userid: ${maskIdentifier(userinfo[i].userid)} 此账号已存在, 仅更新登录信息`)
                  userinfo[i].token = res.data.token
                }
              }
            }
            if (!userAlreadyExist) {
              userinfo.push({
                userid: res.data.userid,
                token: res.data.token
              })
            }
            break;
          default:
            printRed("请求出错")
            console.dir(summarizeResponse(res), { depth: null })
        }
        if (status == 4 || status == 0) {
          break
        }
        if (i == 24) {
          printRed("等待超时\n")
          break
        }
        await delay(5000)
      }
    }
    if (userinfo.length) {
      await saveUserinfo(userinfo)
    }
  } finally {
    close_api(api)
  }

  if (api.killed) {
    process.exit(0)
  }
}

qrcode()
