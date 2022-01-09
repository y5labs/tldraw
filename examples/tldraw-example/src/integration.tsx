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

  const uris = new Map()

  const addIntegrationChild = async (parentId, id, params) => {
    app.current.addIntegrationShape(id, {
      integrationParentShapeId: parentId,
      size: [300, 42],
      ...params
    })
  }

  const parseUri = s => {
    const chunks = s.split(' ')
    const uri = chunks.length == 1
      ? chunks[0] : chunks[0].length < 5
      ? chunks[1] : chunks[0]
    return uri
  }

  const getPageIntegrations = () =>
    new Map(app.current.shapes
      .filter(s => s.type === TDShapeType.Integration
        && s.integrationParentShapeId == null)
      .map(s => [parseUri(s.text), s]))

  const sanitizePageIntegrations = () => {
    // remove integrations that:
    // - share a uri
    // remove integration instances that:
    // - do not point to an integration
    // - share an integration id within the same integration
    // This is usually due to creating an additional integration with the same uri or cloning an integration
    const toDelete = []
    const uris = new Set()
    const byShapeId = new Map()
    const shapes = app.current.shapes.slice()
    shapes.sort((a, b) => a.id - b.id)
    for (const s of shapes) {
      if (s.type !== TDShapeType.Integration
        || s.integrationParentShapeId != null) continue
      const uri = parseUri(s.text)
      if (uris.has(uri)) {
        toDelete.push(s.id)
        continue
      }
      uris.add(uri)
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

  const detectAndApplyIntegrationChanges = async () => {
    if (!app.current) return

    const next = getPageIntegrations()
    const changes = diff(uris, next)
    const toDelete = new Set()
    if (changes.create.size > 0 || changes.delete.size > 0)
      console.log(`Δ ${Object.entries(changes)
        .map(([k, v]) => `${k[0]}${v.size}`)
        .join(' ')}`)
    for (const [uri, shape] of changes.delete) {
      app.current.shapes
        .filter(s => s.type == TDShapeType.Integration
          || s.integrationParentShapeId == shape.id)
        .forEach(s => toDelete.add(s.id))
      console.log(`${uri} stopping service`)
      uris.delete(uri)
    }
    for (const [uri, shape] of changes.create) {
      uris.set(uri, { uri, shape })
      console.log(`${uri} starting service`)
      // remove deletions that are really renames
      toDelete.delete(shape.id)
    }
    app.current.delete(Array.from(toDelete.values()))
  }

  const retreiveInstanceState = async () => {
    for (const i of uris.values()) {
      console.log('querying', i.uri)

    }
  }

  const detectAndApplyInstanceChanges = async () => {
    const integrationShapes = new Map()
    for (const i of uris.values()) {
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
          text: `Test ${i.uri}`
        }]
      ])
      const changes = diff(i.children, next)
      if (changes.create.size > 0 || changes.delete.size > 0)
        console.log(`${i.uri} Δ ${Object.entries(changes)
          .map(([k, v]) => `${k[0]}${v.size}`)
          .join(' ')}`)
      app.current.delete(Array.from(changes.delete.values()).map(s => s.id))
      for (const s of Array.from(changes.create.values())) {
        await addIntegrationChild(i.shape.id, s.instanceId, s)
      }
    }
  }

  React.useEffect(() => {
    const handle = setInterval(debounce(async () => {
      if (!app.current
        || app.current.pageState.selectedIds.length != 0) return
      await sanitizePageIntegrations()
      await detectAndApplyIntegrationChanges()
      await retreiveInstanceState()
      await detectAndApplyInstanceChanges()
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
