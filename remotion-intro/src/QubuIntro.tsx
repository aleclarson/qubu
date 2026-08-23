import { loadFont } from '@remotion/google-fonts/SpaceGrotesk'
import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import {
  BigText,
  CodeWindow,
  enter,
  Eyebrow,
  Pop,
  Shell,
  Token,
  Wordmark,
} from './components'
import { colors, shadow } from './theme'

const { fontFamily } = loadFont('normal', { weights: ['400', '500', '700'] })
const mono = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'

const Opening = () => {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const portrait = height > width
  const slide = interpolate(frame, [0, 55], [portrait ? 420 : 680, 0], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.exp),
  })
  return (
    <Shell>
      <Wordmark />
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          paddingBottom: portrait ? 170 : 70,
        }}
      >
        <Pop delay={8}>
          <Eyebrow>Typed SQL for TypeScript</Eyebrow>
        </Pop>
        <Pop delay={16}>
          <BigText style={{ marginTop: 34 }}>
            Write the query.
            <br />
            <span style={{ color: colors.blue }}>Keep the types.</span>
          </BigText>
        </Pop>
        <div
          style={{
            marginTop: 62,
            height: 14,
            width: portrait ? '100%' : '72%',
            borderRadius: 20,
            background: colors.ink,
            transform: `translateX(${slide}px)`,
          }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          fontSize: portrait ? 160 : 210,
          fontWeight: 800,
          color: colors.blue,
          opacity: 0.09,
          letterSpacing: '-.08em',
        }}
      >
        SELECT
      </div>
    </Shell>
  )
}

const QueryScene = () => {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const portrait = height > width
  const lines = [
    <>
      <Token tone="blue">const</Token> users = table(
      <Token tone="coral">'users'</Token>, {'{'}
    </>,
    <> id: integer(),</>,
    <> name: text(),</>,
    <>{'}'})</>,
    <></>,
    <>
      <Token tone="blue">const</Token> query = select(
    </>,
    <>
      {' '}
      {'{'} id: users.id, name: users.name {'}'},
    </>,
    <> from(users),</>,
    <>
      {' '}
      where(eq(users.id, <Token tone="mint">42</Token>)),
    </>,
    <>)</>,
  ]
  return (
    <Shell dark>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: portrait ? '1fr' : '0.75fr 1.25fr',
          gridAutoRows: portrait ? 'max-content' : undefined,
          alignContent: portrait ? 'center' : undefined,
          gap: portrait ? 64 : 100,
          alignItems: 'center',
          height: '100%',
        }}
      >
        <Pop delay={4}>
          <Eyebrow>01 · Values compose</Eyebrow>
          <BigText style={{ fontSize: portrait ? 82 : 86, marginTop: 30 }}>
            A query is a value.
          </BigText>
          <div
            style={{
              fontSize: portrait ? 34 : 30,
              lineHeight: 1.35,
              color: '#B8BAB7',
              marginTop: 42,
              maxWidth: 600,
            }}
          >
            Tables, expressions, and clauses fit together without a mutable
            builder.
          </div>
        </Pop>
        <Pop delay={12}>
          <CodeWindow
            style={{ width: '100%' }}
            codeStyle={
              portrait
                ? { fontSize: 29, lineHeight: 1.42, padding: '34px 38px 42px' }
                : undefined
            }
          >
            {lines.map((line, index) => {
              const visible = enter(frame, 18 + index * 5)
              return (
                <div
                  key={index}
                  style={{
                    opacity: visible,
                    transform: `translateX(${(1 - visible) * 24}px)`,
                  }}
                >
                  {line || '\u00a0'}
                </div>
              )
            })}
          </CodeWindow>
        </Pop>
      </div>
    </Shell>
  )
}

const TypeScene = () => {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const portrait = height > width
  const wire = interpolate(frame, [30, 85], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const cards = [
    {
      name: 'Source scope',
      note: 'missing FROM fails the build',
      color: colors.coral,
    },
    {
      name: 'Result shape',
      note: '{ id: number; name: string }',
      color: colors.mint,
    },
    {
      name: 'Nullability',
      note: 'joins widen only affected fields',
      color: '#8DAAFF',
    },
  ]
  return (
    <Shell>
      <Pop delay={3}>
        <Eyebrow>02 · Types follow the SQL</Eyebrow>
      </Pop>
      <Pop delay={9}>
        <BigText style={{ fontSize: portrait ? 82 : 90, marginTop: 28 }}>
          Catch relational mistakes
          <br />
          before the database.
        </BigText>
      </Pop>
      <div
        style={{
          position: 'relative',
          marginTop: portrait ? 120 : 86,
          display: 'grid',
          gridTemplateColumns: portrait ? '1fr' : 'repeat(3, 1fr)',
          gap: 28,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: portrait ? 36 : '14%',
            top: portrait ? 20 : '50%',
            height: portrait ? `calc(${wire * 100}% - 40px)` : 6,
            width: portrait ? 6 : `${wire * 72}%`,
            background: colors.ink,
            opacity: 0.18,
          }}
        />
        {cards.map((card, index) => (
          <Pop key={card.name} delay={20 + index * 12}>
            <div
              style={{
                position: 'relative',
                minHeight: portrait ? 210 : 245,
                borderRadius: 26,
                background: colors.white,
                border: '2px solid rgba(21,23,22,.09)',
                boxShadow: shadow,
                padding: portrait ? '38px 42px 38px 92px' : 40,
              }}
            >
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 20,
                  background: card.color,
                  position: 'absolute',
                  left: portrait ? 28 : 40,
                  top: portrait ? 48 : 40,
                }}
              />
              <div
                style={{
                  fontSize: portrait ? 38 : 34,
                  fontWeight: 700,
                  letterSpacing: '-.035em',
                }}
              >
                {card.name}
              </div>
              <div
                style={{
                  fontFamily: mono,
                  fontSize: portrait ? 25 : 22,
                  color: colors.muted,
                  lineHeight: 1.45,
                  marginTop: 20,
                }}
              >
                {card.note}
              </div>
            </div>
          </Pop>
        ))}
      </div>
    </Shell>
  )
}

const ParameterScene = () => {
  const { width, height } = useVideoConfig()
  const portrait = height > width
  return (
    <Shell dark>
      <Pop delay={3}>
        <Eyebrow>03 · Values become parameters</Eyebrow>
      </Pop>
      <Pop delay={9}>
        <BigText style={{ fontSize: portrait ? 82 : 92, marginTop: 28 }}>
          The value stays
          <br />
          <span style={{ color: colors.mint }}>out of the SQL.</span>
        </BigText>
      </Pop>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: portrait ? '1fr' : '0.8fr 1.2fr',
          gap: portrait ? 34 : 70,
          alignItems: 'center',
          marginTop: portrait ? 100 : 78,
        }}
      >
        <Pop delay={20}>
          <div
            style={{
              border: '2px solid #373B39',
              borderRadius: 26,
              padding: portrait ? 40 : 36,
              fontFamily: mono,
              fontSize: portrait ? 30 : 28,
              background: '#202321',
            }}
          >
            where(eq(users.id, <span style={{ color: colors.mint }}>42</span>))
          </div>
        </Pop>
        <Pop delay={34}>
          <div
            style={{
              borderRadius: 26,
              padding: portrait ? 40 : 36,
              background: colors.white,
              color: colors.ink,
              boxShadow: shadow,
            }}
          >
            <div
              style={{
                fontFamily: mono,
                fontSize: portrait ? 27 : 27,
                lineHeight: 1.55,
              }}
            >
              WHERE (&quot;users&quot;.&quot;id&quot; = ?)
            </div>
            <div
              style={{
                fontFamily: mono,
                fontSize: portrait ? 27 : 24,
                color: colors.blue,
                marginTop: 22,
              }}
            >
              parameters: [42]
            </div>
          </div>
        </Pop>
      </div>
    </Shell>
  )
}

const DialectScene = () => {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const portrait = height > width
  const progress = interpolate(frame, [18, 78], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  })
  return (
    <Shell accent>
      <Pop delay={2}>
        <Eyebrow>
          <span style={{ color: colors.mint }}>04 · Render explicitly</span>
        </Eyebrow>
      </Pop>
      <Pop delay={8}>
        <BigText
          style={{
            fontSize: portrait ? 82 : 90,
            marginTop: 28,
            color: colors.white,
          }}
        >
          One query.
          <br />
          The dialect you choose.
        </BigText>
      </Pop>
      <div
        style={{
          marginTop: portrait ? 120 : 76,
          display: 'grid',
          gridTemplateColumns: portrait ? '1fr' : '1fr 1fr',
          gap: 30,
        }}
      >
        {[
          ['Standard / SQLite', 'WHERE ("users"."id" = ?)'],
          ['PostgreSQL', 'WHERE ("users"."id" = $1)'],
        ].map(([label, sql], index) => (
          <Pop key={label} delay={20 + index * 14}>
            <div
              style={{
                background: colors.white,
                color: colors.ink,
                borderRadius: 28,
                padding: portrait ? 48 : 42,
                boxShadow: shadow,
              }}
            >
              <div
                style={{
                  fontSize: 21,
                  color: colors.blue,
                  fontWeight: 750,
                  textTransform: 'uppercase',
                  letterSpacing: '.12em',
                }}
              >
                {label}
              </div>
              <div
                style={{
                  fontFamily: mono,
                  fontSize: portrait ? 29 : 27,
                  marginTop: 34,
                  lineHeight: 1.5,
                }}
              >
                {sql}
              </div>
              <div
                style={{
                  height: 7,
                  marginTop: 38,
                  background: '#E3E1DB',
                  borderRadius: 20,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${progress * 100}%`,
                    background: index ? colors.coral : colors.mint,
                  }}
                />
              </div>
            </div>
          </Pop>
        ))}
      </div>
    </Shell>
  )
}

const ViteScene = () => {
  const { width, height } = useVideoConfig()
  const portrait = height > width
  return (
    <Shell>
      <Pop delay={3}>
        <Eyebrow>05 · Optional Vite plugin</Eyebrow>
      </Pop>
      <Pop delay={9}>
        <BigText style={{ fontSize: portrait ? 84 : 94, marginTop: 28 }}>
          Skip the import wall.
        </BigText>
      </Pop>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: portrait ? '1fr' : '1fr 80px 1fr',
          alignItems: 'center',
          gap: portrait ? 28 : 24,
          marginTop: portrait ? 110 : 90,
        }}
      >
        <Pop delay={18}>
          <div
            style={{
              borderRadius: 26,
              padding: portrait ? 42 : 38,
              background: colors.white,
              border: '2px solid rgba(21,23,22,.09)',
              boxShadow: shadow,
            }}
          >
            <div
              style={{
                fontSize: 20,
                color: colors.muted,
                fontWeight: 700,
                letterSpacing: '.13em',
                textTransform: 'uppercase',
              }}
            >
              Without the plugin
            </div>
            <div
              style={{
                fontFamily: mono,
                fontSize: portrait ? 26 : 24,
                lineHeight: 1.5,
                marginTop: 28,
                color: colors.muted,
              }}
            >
              import {'{'} eq, from, integer,
              <br />
              select, table, text, where {'}'}
              <br />
              from <span style={{ color: colors.coral }}>'qubu'</span>
            </div>
          </div>
        </Pop>
        <Pop
          delay={30}
          style={{
            fontSize: 50,
            color: colors.blue,
            textAlign: 'center',
            transform: portrait ? 'rotate(90deg)' : undefined,
          }}
        >
          →
        </Pop>
        <Pop delay={38}>
          <div
            style={{
              borderRadius: 26,
              padding: portrait ? 42 : 38,
              background: colors.ink,
              color: colors.white,
              boxShadow: shadow,
            }}
          >
            <div
              style={{
                fontSize: 20,
                color: colors.mint,
                fontWeight: 700,
                letterSpacing: '.13em',
                textTransform: 'uppercase',
              }}
            >
              With the plugin
            </div>
            <div
              style={{
                fontFamily: mono,
                fontSize: portrait ? 32 : 31,
                marginTop: 34,
              }}
            >
              <span style={{ color: colors.coral }}>'use qubu'</span>
            </div>
          </div>
        </Pop>
      </div>
      <Pop delay={54} style={{ marginTop: portrait ? 82 : 60 }}>
        <div style={{ color: colors.muted, fontSize: portrait ? 30 : 27 }}>
          It inserts only the Qubu imports that file uses.
        </div>
      </Pop>
    </Shell>
  )
}

const Finale = () => {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const portrait = height > width
  const orbit = interpolate(frame, [0, 150], [0, 360])
  return (
    <Shell>
      <div
        style={{
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          textAlign: 'center',
        }}
      >
        <div>
          <Pop delay={4} style={{ display: 'flex', justifyContent: 'center' }}>
            <Wordmark />
          </Pop>
          <Pop delay={12}>
            <BigText style={{ fontSize: portrait ? 100 : 118, marginTop: 50 }}>
              Qubu builds SQL.
              <br />
              <span style={{ color: colors.blue }}>Your driver runs it.</span>
            </BigText>
          </Pop>
          <Pop delay={20}>
            <div
              style={{
                fontSize: portrait ? 28 : 26,
                color: colors.muted,
                marginTop: 34,
              }}
            >
              Typed composition. Explicit execution.
            </div>
          </Pop>
          <Pop delay={26}>
            <div
              style={{
                marginTop: 44,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 18,
                borderRadius: 100,
                padding: '20px 32px',
                background: colors.ink,
                color: colors.white,
                fontFamily: mono,
                fontSize: portrait ? 27 : 25,
              }}
            >
              <span style={{ color: colors.mint }}>$</span> npm install qubu
            </div>
          </Pop>
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          width: portrait ? 520 : 700,
          height: portrait ? 520 : 700,
          border: `2px solid ${colors.blue}`,
          borderRadius: '50%',
          opacity: 0.15,
          right: portrait ? -300 : -250,
          top: portrait ? -250 : -360,
          transform: `rotate(${orbit}deg)`,
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 30,
            background: colors.coral,
            position: 'absolute',
            left: '48%',
            bottom: -17,
          }}
        />
      </div>
    </Shell>
  )
}

export const QubuIntro = () => (
  <AbsoluteFill style={{ fontFamily }}>
    <Sequence durationInFrames={100}>
      <Opening />
    </Sequence>
    <Sequence from={100} durationInFrames={170}>
      <QueryScene />
    </Sequence>
    <Sequence from={270} durationInFrames={140}>
      <TypeScene />
    </Sequence>
    <Sequence from={410} durationInFrames={120}>
      <ParameterScene />
    </Sequence>
    <Sequence from={530} durationInFrames={120}>
      <DialectScene />
    </Sequence>
    <Sequence from={650} durationInFrames={150}>
      <ViteScene />
    </Sequence>
    <Sequence from={800} durationInFrames={100}>
      <Finale />
    </Sequence>
  </AbsoluteFill>
)
