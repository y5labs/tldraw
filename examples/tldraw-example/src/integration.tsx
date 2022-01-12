import * as React from 'react'
import {
  TDShapeType,
  Tldraw,
  TldrawApp,
  FontStyle,
  SizeStyle,
  TDFile
} from '@tldraw/tldraw'

import { migrate } from '@tldraw/tldraw/src/state/data/migrate'

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

const diff = (prev, next) => {
  const res = {
    create: new Map(),
    delete: new Map(),
    same: new Map()
  }
  for (const [key, value] of prev.entries()) {
    if (!next.has(key)) res.delete.set(key, value)
    else res.same.set(key, [value, next.get(key)])
  }
  for (const [key, value] of next.entries()) {
    if (!prev.has(key)) res.create.set(key, value)
  }
  return res
}


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
    for (const [uri, { shape }] of changes.delete) {
      // console.log(`Checking children of`, shape)
      app.current.shapes
        .filter(s => s.type == TDShapeType.Integration
          && s.integrationParentShapeId == shape.id)
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
    for (const [uri, [_, shape]] of changes.same)
      uris.get(uri).shape = shape
    if (toDelete.size) {
      console.log(
        `Cleaning up ${toDelete.size} unknown shapes`,
        Array.from(toDelete.values()).map(id => app.current.getShape(id))
      )
      app.current.delete(Array.from(toDelete.values()))
    }
  }

  const retreiveInstanceState = async () => {
    for (const i of uris.values()) {
      i.instances = null
      try {
        const res = await fetch(i.uri)
        if (!res.ok) {
          const message = await res.text()
          console.error(`🔴 ${i.uri}`, message)
          i.status = 'error'
          continue
        }
        Object.assign(i, await res.json())
        i.status = 'ok'
      }
      catch (e) {
        console.error(`🔴 ${i.uri}`, e)
        i.status = 'error'
      }
    }
  }

  const setIntegrationStatuses = async () => {
    for (const i of uris.values()) {
      const text =
        i.status == 'ok'
        ? i.uri
        : `🔴 ${i.uri}`
      if (i.shape.text != text)
        app.current?.updateShapes({
          id: i.shape.id,
          text
        })
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
      if (!i.instances) continue
      const next = new Map(i.instances.map(i => [i.instanceId, i]))
      const changes = diff(i.children, next)
      if (changes.create.size > 0 || changes.delete.size > 0)
        console.log(`${i.uri} Δ ${Object.entries(changes)
          .map(([k, v]) => `${k[0]}${v.size}`)
          .join(' ')}`)
      app.current.delete(Array.from(changes.delete.values()).map(s => s.id))
      for (const s of changes.create.values())
        await addIntegrationChild(i.shape.id, s.instanceId, s)
      const shapeUpdates = Array.from(changes.same.values())
        .filter(([shape, shape_new]) => shape.text != shape_new.text)
        .map(([shape, shape_new]) => ({
          id: shape.id,
          text: shape_new.text
        }))
      if (shapeUpdates.length > 0)
        app.current.updateShapes(...shapeUpdates)
    }
  }

  React.useEffect(() => {
    const handle = setInterval(debounce(async () => {
      if (!app.current
        || app.current.pageState.selectedIds.length != 0) return
      await sanitizePageIntegrations()
      await detectAndApplyIntegrationChanges()
      await retreiveInstanceState()
      await setIntegrationStatuses()
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
  const [file, setFile] = React.useState<TDFile>()

  React.useEffect(() => {
    (async () => {
      await sleep(1000)
      setFile({
        "name": "New Document",
        "fileHandle": null,
        "document": {
          "id": "doc",
          "name": "New Document",
          "version": 15.3,
          "pages": {
            "page": {
              "id": "page",
              "name": "Page 1",
              "childIndex": 1,
              "shapes": {
                "e9a34296-076f-4a1b-0e92-78488891c3d5": {
                  "id": "e9a34296-076f-4a1b-0e92-78488891c3d5",
                  "type": "rectangle",
                  "name": "Rectangle",
                  "parentId": "page",
                  "childIndex": 1,
                  "point": [
                    598,
                    196
                  ],
                  "size": [
                    147,
                    133
                  ],
                  "rotation": 0,
                  "style": {
                    "color": "black",
                    "size": "small",
                    "isFilled": false,
                    "dash": "draw",
                    "scale": 1
                  },
                  "label": "",
                  "labelPoint": [
                    0.5,
                    0.5
                  ]
                }
              },
              "bindings": {}
            }
          },
          "pageStates": {
            "page": {
              "id": "page",
              "selectedIds": [
                "e9a34296-076f-4a1b-0e92-78488891c3d5"
              ],
              "camera": {
                "point": [
                  0,
                  0
                ],
                "zoom": 1
              },
              "editingId": null
            }
          },
          "assets": {}
        },
        "assets": {}
      })
    })()
  }, [])

  const onSaveProject = React.useCallback((app: TldrawApp) => {
    const document = migrate(app.document, TldrawApp.version)
    const file: TDFile = {
      name: document.name || 'New Document',
      fileHandle: null,
      document,
      assets: {},
    }

    console.log(file)
  }, [])

  return <Tldraw
    document={file?.document}
    onSaveProject={onSaveProject}
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
