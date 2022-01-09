import inject from 'seacreature/lib/inject'
import { jwt } from '../lib/y5-crypto'
import fetch from 'node-fetch'
import { NetlifyAPI } from 'netlify'

inject('pod', async ({ app }) => {
  let token_raw = null
  let token = null

  const assert_token = async () => {
    if (token && token.exp - 60 > Date.now() / 1000) return
    // https://github.com/caprover/caprover-cli/blob/master/src/api/ApiManager.ts
    const login = await fetch(`${process.env.CAPROVER_HOST}/api/v2/login`, {
      method: 'POST',
      body: JSON.stringify({
        password: process.env.CAPROVER_PASSWORD
      }),
      headers: {
        'Content-Type': 'application/json',
        'x-namespace': 'captain'
      }
    })
    const { data: { token: token_new } } = await login.json()
    token_raw = token_new
    token = await jwt.decode(token_raw)
  }

  const get_app_definitions = async () => {
    const res = await fetch(`${process.env.CAPROVER_HOST}/api/v2/user/apps/appDefinitions`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-namespace': 'captain',
        'x-captain-auth': token_raw
      }
    })
    if (!res.ok) throw new Error('failed to get app definitions')
    const { data: { appDefinitions } } = await res.json()
    return appDefinitions
  }

  app.get('/caprover', inject.one('req.guard')(async (req, res) => {
    await assert_token()
    const app_definitions = await get_app_definitions()
    // console.log(JSON.stringify(app_definitions?.[0], null, 2))
    res.send({
      instances: app_definitions.map(a => {
        const prefix =
          a.instanceCount == 0
          ? '⚪️ '
          : a.isAppBuilding
          ? '🟡 '
          : ''
        return {
          instanceId: a.appName,
          text: `${prefix}${a.appName}`
        }
      })
    })
  }))

  const client = new NetlifyAPI(process.env.NETLIFY_API_KEY)

  app.get('/netlify', inject.one('req.guard')(async (req, res) => {
    const sites = await client.listSites({ filter: 'all', per_page: 999 })
    res.send({
      instances: sites.map(s => {
        const prefix =
          s.error_message != null
          ? '🔴'
          : s.disabled != null
          ? '⚪️ '
          : ''
        return {
          instanceId: s.id,
          text: `${prefix}${s.url}`
        }
      })
    })
  }))
})
