import * as React from 'react'
import { TDShapeType, Tldraw, TldrawApp, FontStyle, SizeStyle } from '@tldraw/tldraw'

const debounce = (fn: Function) => {
  let current = null
  let next = null
  let next_args = null
  let next_release = null
  const attempt = async (...args) => {
    if (current) {
      next_args = args
      if (next) return await next
      next = new Promise(resolve => next_release = r => { resolve(r) })
      return await next
    }
    current = fn(...args)
    const res = await current
    current = null
    if (next) {
      const now = next
      const now_args = next_args
      const now_release = next_release
      next = null
      next_args = null
      next_release = null
      attempt(...now_args).then(now_release)
    }
    return res
  }
  return attempt
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

const IntegrationContext = React.createContext()

const IntegrationProvider = ({ children }) => {
  const app = React.useRef<TldrawApp>()

  const hosts = new Map()

  const diff = (prev, next) => {
    const res = {
      create: new Map(),
      delete: new Map(),
      same: new Map()
    }
    for (const [key, value] of prev.entries()) {
      if (!next.has(key)) res.delete.set(key, value)
      else res.same.set(key, value)
    }
    for (const [key, value] of next.entries()) {
      if (!prev.has(key)) res.create.set(key, value)
    }
    return res
  }

  const addIntegrationChild = async (parentId, text) => {
    app.current.addIntegrationShape({
      integrationParentId: parentId,
      size: [300, 42],
      text
    })
  }

  const getPageIntegrations = () =>
    new Map(app.current.shapes
      .filter(s => s.type === TDShapeType.Integration
        && s.integrationParentId == null)
      .map(s => {
        const chunks = s.text.split(' ')
        const host = chunks.length == 1
          ? chunks[0] : chunks[0].length <= 1
          ? chunks[1] : chunks[0]
        return [host, s]
      }))

  const detectAndApplyChanges = async () => {
    if (!app.current) return
    const next = getPageIntegrations()
    const changes = diff(hosts, next)
    console.log(`Changes ${Object.entries(changes).map(([k, v]) => `${k[0]}${v.size}`).join(' ')}`)
    for (const [host, shape] of changes.delete) {
      const childIds = app.current.shapes
        .filter(s => s.type == TDShapeType.Integration
          || s.integrationParentId == shape.id)
        .map(s => s.id)
      console.log(`Deleting ${host} and ${childIds.length} children`)
      app.current.delete(childIds)
      hosts.delete(host)
    }
    for (const [host, shape] of changes.create)
      hosts.set(host, shape)
  }

  const api = {
    setApp: (set_app: TldrawApp) => {
      app.current = set_app
    },
    handleChange: debounce(async () => {
      await detectAndApplyChanges()
      await sleep(1000)
    })
  }

  return <IntegrationContext.Provider value={api} children={children} />
}

function App(): JSX.Element {
  const api = React.useContext(IntegrationContext)

  return <Tldraw
    onMount={React.useCallback(api.setApp, [])}
    onChange={React.useCallback(api.handleChange, [])}
    showSponsorLink={false}
  />
}

export default function Integration(): JSX.Element {
  return (
    <IntegrationProvider>
      <div className="tldraw">
        <App />
      </div>
    </IntegrationProvider>
  )
}
