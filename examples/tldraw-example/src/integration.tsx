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

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

const IntegrationContext = React.createContext()

const IntegrationProvider = ({ children }) => {
  const app = React.useRef<TldrawApp>()

  const hosts = new Map()

  const addIntegrationChild = async (parentId, id, params) => {
    app.current.addIntegrationShape(id, {
      integrationParentShapeId: parentId,
      size: [300, 42],
      ...params
    })
  }

  const parseHost = s => {
    const chunks = s.split(' ')
    const host = chunks.length == 1
      ? chunks[0] : chunks[0].length < 5
      ? chunks[1] : chunks[0]
    return host
  }

  const getPageIntegrations = () =>
    new Map(app.current.shapes
      .filter(s => s.type === TDShapeType.Integration
        && s.integrationParentShapeId == null)
      .map(s => [parseHost(s.text), s]))

  const sanitizePageIntegrations = () => {
    // remove integrations that:
    // - share a host
    // remove integration instances that:
    // - do not point to an integration
    // - share an integration id within the same integration
    const toDelete = []
    const hosts = new Set()
    const byShapeId = new Map()
    const shapes = app.current.shapes.slice()
    shapes.sort((a, b) => a.id - b.id)
    for (const s of shapes) {
      if (s.type !== TDShapeType.Integration
        || s.integrationParentShapeId != null) continue
      const host = parseHost(s.text)
      if (hosts.has(host)) {
        toDelete.push(s.id)
        continue
      }
      hosts.add(host)
      byShapeId.set(s.id, new Map())
    }
    for (const s of shapes) {
      if (s.type !== TDShapeType.Integration
        || s.integrationParentShapeId == null) continue
      if (!byShapeId.has(s.integrationParentShapeId)) {
        toDelete.push(s.id)
        continue
      }
      const i = byShapeId.get(s.integrationParentShapeId)
      if (i.has(s.instanceId)) {
        toDelete.push(s.id)
        continue
      }
      i.set(s.instanceId, s)
    }
    app.current.delete(toDelete)
  }

  const detectAndApplyChanges = async () => {
    if (!app.current) return

    const next = getPageIntegrations()
    const changes = diff(hosts, next)
    if (changes.create.size > 0 || changes.delete.size > 0)
      console.log(`Δ ${Object.entries(changes)
        .map(([k, v]) => `${k[0]}${v.size}`)
        .join(' ')}`)
    for (const [host, shape] of changes.delete) {
      const childIds = app.current.shapes
        .filter(s => s.type == TDShapeType.Integration
          || s.integrationParentShapeId == shape.id)
        .map(s => s.id)
      console.log(`Deleting ${host} and ${childIds.length} children`)
      app.current.delete(childIds)
      hosts.delete(host)
    }
    for (const [host, shape] of changes.create) {
      hosts.set(host, { host, shape })
      // addIntegrationChild(shape.id, 1, `Test ${host}`)
    }
  }

  React.useEffect(() => {
    const handle = setInterval(debounce(async () => {
      if (!app.current
        || app.current.pageState.selectedIds.length != 0) return
      await sanitizePageIntegrations()
      await detectAndApplyChanges()
      const integrationShapes = new Map()
      for (const i of hosts.values()) {
        integrationShapes.set(i.shape.id, i)
        i.children = new Map()
      }
      for (const s of app.current.shapes) {
        if (s.type != TDShapeType.Integration
          || !integrationShapes.has(s.integrationParentShapeId))
          continue
        const integrationShape = integrationShapes.get(s.integrationParentShapeId)
        integrationShape.children.set(s.instanceId, s)
      }
      for (const i of integrationShapes.values()) {
        const next = new Map([
          ['id1', {
            instanceId: 'id1',
            text: `Test ${i.host}`
          }]
        ])
        const changes = diff(i.children, next)
        if (changes.create.size > 0 || changes.delete.size > 0)
          console.log(`${i.host} Δ ${Object.entries(changes)
            .map(([k, v]) => `${k[0]}${v.size}`)
            .join(' ')}`)
        app.current.delete(Array.from(changes.delete.values()).map(s => s.id))
        for (const s of Array.from(changes.create.values())) {
          await addIntegrationChild(i.shape.id, s.instanceId, s)
        }
      }
    }), 2000)
    return () => {
      clearInterval(handle)
    }
  }, [])

  const api = {
    setApp: (set_app: TldrawApp) => app.current = set_app
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
