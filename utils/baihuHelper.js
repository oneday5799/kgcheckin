import { printBlue, printGreen, printRed, printYellow } from "./colorOut.js";
import { hasSecretWriteToken, setRepoSecret } from "./githubSecrets.js";
import { sanitizeForLog, shouldPrintSensitiveValue } from "./safeLog.js";

/**
 * 检测当前运行环境
 * @returns {'baihu'|'github'|'local'}
 */
function detectEnvironment() {
  if (process.env.OPENAPI_TOKEN) {
    return 'baihu';
  }
  if (hasSecretWriteToken()) {
    return 'github';
  }
  return 'local';
}

/**
 * 获取白虎面板 API 基础配置
 */
function getBaihuApiConfig() {
  const token = process.env.OPENAPI_TOKEN;
  const baseUrl = process.env.BAIHU_API_URL || 'http://localhost:8052';
  return { token, baseUrl };
}

/**
 * 通过白虎面板 REST API 写环境变量
 * 先查询是否存在同名变量，存在则更新，不存在则创建
 */
async function saveUserinfoViaBaihuApi(userinfo) {
  const { token, baseUrl } = getBaihuApiConfig();
  const userinfoJSON = JSON.stringify(userinfo);

  // 查找已有的 USERINFO 变量
  const listResp = await fetch(`${baseUrl}/open2api/v1/envs?search=USERINFO`, {
    headers: { 'Authorization': `Bearer ${token}` }
  }).then(r => r.json());

  // 在返回列表中查找精确匹配 NAME=USERINFO 的条目
  const existing = Array.isArray(listResp?.data)
    ? listResp.data.find(e => e.name === 'USERINFO')
    : null;

  if (existing) {
    // 更新已有变量
    const resp = await fetch(`${baseUrl}/open2api/v1/envs/${existing.id}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ value: userinfoJSON })
    });
    if (!resp.ok) {
      throw new Error(`更新环境变量失败: HTTP ${resp.status}`);
    }
  } else {
    // 创建新变量
    const resp = await fetch(`${baseUrl}/open2api/v1/envs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'USERINFO',
        value: userinfoJSON,
        remarks: 'Kugou 签到账号信息（由脚本自动管理）'
      })
    });
    if (!resp.ok) {
      throw new Error(`创建环境变量失败: HTTP ${resp.status}`);
    }
  }
}

/**
 * 保存 USERINFO 到环境变量（自动选择存储方式）
 * 优先级：白虎面板 API > GitHub Secrets > 控制台打印
 * @param {Array} userinfo - 用户信息数组
 */
async function saveUserinfo(userinfo) {
  const env = detectEnvironment();
  const userinfoJSON = JSON.stringify(userinfo);

  // 尝试白虎面板 API
  if (env === 'baihu') {
    try {
      await saveUserinfoViaBaihuApi(userinfo);
      printGreen("环境变量 <USERINFO> 更改成功（白虎面板）");
      return;
    } catch (error) {
      printRed(`白虎面板 API 写入失败: ${error.message}`);
      // 继续尝试降级
    }
  }

  // 尝试 GitHub Secrets
  if (env === 'github') {
    try {
      setRepoSecret("USERINFO", userinfoJSON);
      printGreen("secret <USERINFO> 更改成功");
      return;
    } catch (error) {
      printRed("自动写入 secret <USERINFO> 出错");
      console.dir(sanitizeForLog({ message: error.message }), { depth: null });
      // 继续尝试降级
    }
  }

  // 降级：控制台输出
  if (shouldPrintSensitiveValue()) {
    printYellow("已按显式配置输出 USERINFO；请用完后删除日志");
    printBlue(userinfoJSON);
  } else {
    printYellow("未检测到有效的存储方式（OPENAPI_TOKEN / PAT / GH_TOKEN），无法自动保存 USERINFO");
    printYellow("请手动配置环境变量，或设置 print_userinfo=是 以在日志中查看");
  }
}

/**
 * 发送通知
 * 优先使用 baihu 内置包，降级使用 REST API，再降级使用 console
 * @param {string} title - 通知标题
 * @param {string} content - 通知内容
 */
async function notify(title, content) {
  const env = detectEnvironment();

  // 在白虎面板环境中尝试 baihu 内置包
  if (env === 'baihu') {
    try {
      // baihu 是白虎面板内置包，使用动态 import 避免本地报错
      const baihu = await import('baihu');
      if (typeof baihu.notify === 'function') {
        await baihu.notify(title, content);
        return;
      }
    } catch {
      // baihu 包不可用（本地环境或旧版本），尝试 REST API
    }

    try {
      const { token, baseUrl } = getBaihuApiConfig();
      const resp = await fetch(`${baseUrl}/open2api/v1/notify`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ title, content })
      });
      if (resp.ok) return;
    } catch {
      // REST API 也失败，降级到 console
    }
  }

  // 降级输出到控制台
  printBlue(`[通知] ${title}`);
  console.log(content);
}

export { saveUserinfo, notify, detectEnvironment };
