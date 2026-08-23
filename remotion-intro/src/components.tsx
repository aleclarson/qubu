import type { CSSProperties, ReactNode } from 'react'
import {
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import { colors, shadow } from './theme'

export const enter = (frame: number, delay = 0) =>
  interpolate(frame, [delay, delay + 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  })

export const Wordmark = ({ light = false }: { light?: boolean }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
    <div
      style={{
        width: 42,
        height: 42,
        borderRadius: 12,
        background: colors.blue,
        display: 'grid',
        placeItems: 'center',
        color: colors.white,
        fontWeight: 800,
        fontSize: 24,
        boxShadow: 'inset 0 -4px 0 rgba(0,0,0,.12)',
      }}
    >
      Q
    </div>
    <div
      style={{
        fontSize: 34,
        fontWeight: 760,
        letterSpacing: '-0.05em',
        color: light ? colors.white : colors.ink,
      }}
    >
      qubu
    </div>
  </div>
)

export const Shell = ({
  children,
  dark = false,
  accent = false,
}: {
  children: ReactNode
  dark?: boolean
  accent?: boolean
}) => {
  const { width, height } = useVideoConfig()
  const portrait = height > width
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
        boxSizing: 'border-box',
        padding: portrait ? '108px 78px' : '70px 100px',
        color: dark ? colors.white : colors.ink,
        background: accent ? colors.blue : dark ? colors.ink : colors.paper,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: dark || accent ? 0.06 : 0.045,
          backgroundImage:
            'linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)',
          backgroundSize: portrait ? '64px 64px' : '72px 72px',
        }}
      />
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {children}
      </div>
    </div>
  )
}

export const Eyebrow = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      fontSize: 22,
      textTransform: 'uppercase',
      letterSpacing: '0.16em',
      fontWeight: 750,
      color: colors.blue,
    }}
  >
    {children}
  </div>
)

export const BigText = ({
  children,
  style,
}: {
  children: ReactNode
  style?: CSSProperties
}) => {
  const { width, height } = useVideoConfig()
  return (
    <div
      style={{
        fontSize: height > width ? 104 : 112,
        lineHeight: 0.94,
        letterSpacing: '-0.065em',
        fontWeight: 780,
        maxWidth: height > width ? 900 : 1450,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export const CodeWindow = ({
  children,
  title = 'query.ts',
  style,
  codeStyle,
}: {
  children: ReactNode
  title?: string
  style?: CSSProperties
  codeStyle?: CSSProperties
}) => {
  const { width, height } = useVideoConfig()
  const portrait = height > width
  const dotSize = portrait ? 19 : 13

  return (
    <div
      style={{
        borderRadius: 28,
        background: '#171A1C',
        color: '#E9EBE7',
        boxShadow: shadow,
        overflow: 'hidden',
        ...style,
      }}
    >
      <div
        style={{
          height: portrait ? 82 : 62,
          display: 'flex',
          alignItems: 'center',
          borderBottom: '1px solid #303437',
          padding: portrait ? '0 30px' : '0 24px',
          gap: portrait ? 14 : 10,
          color: '#969B9E',
          fontFamily: 'monospace',
          fontSize: portrait ? 23 : 17,
        }}
      >
        <span
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: 20,
            background: colors.coral,
          }}
        />
        <span
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: 20,
            background: '#F7C95E',
          }}
        />
        <span
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: 20,
            background: colors.mint,
          }}
        />
        <span style={{ marginLeft: portrait ? 20 : 16 }}>{title}</span>
      </div>
      <div
        style={{
          padding: '30px 34px 38px',
          fontFamily: 'monospace',
          fontSize: 24,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          ...codeStyle,
        }}
      >
        {children}
      </div>
    </div>
  )
}

export const Token = ({
  children,
  tone = 'plain',
}: {
  children: ReactNode
  tone?: 'plain' | 'blue' | 'mint' | 'coral'
}) => (
  <span
    style={{
      color:
        tone === 'blue'
          ? '#81A5FF'
          : tone === 'mint'
            ? colors.mint
            : tone === 'coral'
              ? '#FF9C8D'
              : undefined,
    }}
  >
    {children}
  </span>
)

export const Pop = ({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode
  delay?: number
  style?: CSSProperties
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const scale = spring({
    frame: frame - delay,
    fps,
    config: { damping: 14, stiffness: 150 },
  })
  return (
    <div
      style={{
        opacity: enter(frame, delay),
        transform: `translateY(${(1 - scale) * 42}px) scale(${0.94 + scale * 0.06})`,
        ...style,
      }}
    >
      {children}
    </div>
  )
}
