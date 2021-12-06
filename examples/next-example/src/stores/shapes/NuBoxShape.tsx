/* eslint-disable @typescript-eslint/no-explicit-any */
import * as React from 'react'
import {
  SVGContainer,
  TLNuIndicatorProps,
  TLNuComponentProps,
  TLNuShapeProps,
  TLNuBoxShape,
  TLNuBounds,
} from '@tldraw/next'
import { observer } from 'mobx-react-lite'
import { observable, makeObservable } from 'mobx'
import type { NuBaseShapeProps } from './NuBaseShape'

export interface NuBoxShapeProps extends NuBaseShapeProps {
  size: number[]
}

export class NuBoxShape extends TLNuBoxShape<NuBoxShapeProps> {
  constructor(props = {} as TLNuShapeProps & Partial<NuBoxShapeProps>) {
    super(props)
    const { stroke = '#000000', fill = '#ffffffcc', strokeWidth = 2 } = props
    this.stroke = stroke
    this.fill = fill
    this.strokeWidth = strokeWidth
    makeObservable(this)
  }

  static id = 'box'

  @observable stroke: string
  @observable fill: string
  @observable strokeWidth: number

  Component = observer(({ events }: TLNuComponentProps) => {
    const {
      size: [w, h],
      stroke,
      fill,
      strokeWidth,
    } = this

    return (
      <SVGContainer {...events}>
        <rect
          x={strokeWidth / 2}
          y={strokeWidth / 2}
          width={Math.max(0.01, w - strokeWidth)}
          height={Math.max(0.01, h - strokeWidth)}
          stroke={stroke}
          fill={fill}
          strokeWidth={strokeWidth}
          pointerEvents="all"
        />
      </SVGContainer>
    )
  })

  Indicator = (props: TLNuIndicatorProps) => {
    return (
      <rect
        className="nu-indicator"
        width={this.size[0]}
        height={this.size[1]}
        strokeWidth={2}
        fill="transparent"
      />
    )
  }
}