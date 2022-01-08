import * as React from 'react'
import { Tldraw, TldrawApp} from '@tldraw/tldraw'

export default function Integration(): JSX.Element {
  const appState = React.useRef<TldrawApp>()

  const handleMount = React.useCallback((app: TldrawApp) => {
    appState.current = app
    console.log('handleMount')
  }, [])

  const handleChange = React.useCallback((app: TldrawApp) => {
    console.log('handleChange')
  }, [])

  return (
    <div className="tldraw">
      <Tldraw
        onMount={handleMount}
        onChange={handleChange}
        />
    </div>
  )
}
