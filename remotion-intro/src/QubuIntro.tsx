import {loadFont} from '@remotion/google-fonts/SpaceGrotesk';
import {AbsoluteFill, Easing, interpolate, Sequence, useCurrentFrame, useVideoConfig} from 'remotion';
import {BigText, CodeWindow, enter, Eyebrow, Pop, Shell, Token, Wordmark} from './components';
import {colors, shadow} from './theme';

const {fontFamily} = loadFont('normal', {weights: ['400', '500', '700']});
const mono = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

const Opening = () => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const portrait = height > width;
  const slide = interpolate(frame, [0, 55], [portrait ? 420 : 680, 0], {extrapolateRight: 'clamp', easing: Easing.out(Easing.exp)});
  return (
    <Shell>
      <Wordmark />
      <div style={{height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingBottom: portrait ? 170 : 70}}>
        <Pop delay={8}>
          <Eyebrow>Typed SQL for TypeScript</Eyebrow>
        </Pop>
        <Pop delay={16}>
          <BigText style={{marginTop: 34}}>Write the query.<br /><span style={{color: colors.blue}}>Keep the types.</span></BigText>
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
      <div style={{position: 'absolute', right: 0, bottom: 0, fontSize: portrait ? 160 : 210, fontWeight: 800, color: colors.blue, opacity: 0.09, letterSpacing: '-.08em'}}>SELECT</div>
    </Shell>
  );
};

const QueryScene = () => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const portrait = height > width;
  const lines = [
    <><Token tone="blue">const</Token> users = table(<Token tone="coral">'users'</Token>, {'{'}</>,
    <>  id: integer(),</>,
    <>  name: text(),</>,
    <>{'}'})</>,
    <></>,
    <><Token tone="blue">const</Token> query = select(</>,
    <>  {'{'} id: users.id, name: users.name {'}'},</>,
    <>  from(users),</>,
    <>  where(eq(users.id, <Token tone="mint">42</Token>)),</>,
    <>)</>,
  ];
  return (
    <Shell dark>
      <div style={{display: 'grid', gridTemplateColumns: portrait ? '1fr' : '0.75fr 1.25fr', gridAutoRows: portrait ? 'max-content' : undefined, alignContent: portrait ? 'center' : undefined, gap: portrait ? 64 : 100, alignItems: 'center', height: '100%'}}>
        <Pop delay={4}>
          <Eyebrow>01 · Values compose</Eyebrow>
          <BigText style={{fontSize: portrait ? 82 : 86, marginTop: 30}}>A query is a value.</BigText>
          <div style={{fontSize: portrait ? 34 : 30, lineHeight: 1.35, color: '#B8BAB7', marginTop: 42, maxWidth: 600}}>
            Tables, expressions, and clauses fit together without a mutable builder.
          </div>
        </Pop>
        <Pop delay={12}>
          <CodeWindow
            style={{width: '100%'}}
            codeStyle={portrait ? {fontSize: 29, lineHeight: 1.42, padding: '34px 38px 42px'} : undefined}
          >
            {lines.map((line, index) => {
              const visible = enter(frame, 18 + index * 5);
              return <div key={index} style={{opacity: visible, transform: `translateX(${(1 - visible) * 24}px)`}}>{line || '\u00a0'}</div>;
            })}
          </CodeWindow>
        </Pop>
      </div>
    </Shell>
  );
};

const TypeScene = () => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const portrait = height > width;
  const wire = interpolate(frame, [30, 85], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const cards = [
    {name: 'Source scope', note: 'missing FROM fails the build', color: colors.coral},
    {name: 'Result shape', note: '{ id: number; name: string }', color: colors.mint},
    {name: 'Nullability', note: 'joins widen only affected fields', color: '#8DAAFF'},
  ];
  return (
    <Shell>
      <Pop delay={3}><Eyebrow>02 · Types follow the SQL</Eyebrow></Pop>
      <Pop delay={9}><BigText style={{fontSize: portrait ? 82 : 90, marginTop: 28}}>Catch relational mistakes<br />before the database.</BigText></Pop>
      <div style={{position: 'relative', marginTop: portrait ? 120 : 86, display: 'grid', gridTemplateColumns: portrait ? '1fr' : 'repeat(3, 1fr)', gap: 28}}>
        <div style={{position: 'absolute', left: portrait ? 36 : '14%', top: portrait ? 20 : '50%', height: portrait ? `calc(${wire * 100}% - 40px)` : 6, width: portrait ? 6 : `${wire * 72}%`, background: colors.ink, opacity: 0.18}} />
        {cards.map((card, index) => (
          <Pop key={card.name} delay={20 + index * 12}>
            <div style={{position: 'relative', minHeight: portrait ? 210 : 245, borderRadius: 26, background: colors.white, border: '2px solid rgba(21,23,22,.09)', boxShadow: shadow, padding: portrait ? '38px 42px 38px 92px' : 40}}>
              <div style={{width: 20, height: 20, borderRadius: 20, background: card.color, position: 'absolute', left: portrait ? 28 : 40, top: portrait ? 48 : 40}} />
              <div style={{fontSize: portrait ? 38 : 34, fontWeight: 700, letterSpacing: '-.035em'}}>{card.name}</div>
              <div style={{fontFamily: mono, fontSize: portrait ? 25 : 22, color: colors.muted, lineHeight: 1.45, marginTop: 20}}>{card.note}</div>
            </div>
          </Pop>
        ))}
      </div>
    </Shell>
  );
};

const RenderScene = () => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const portrait = height > width;
  const progress = interpolate(frame, [18, 78], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  return (
    <Shell accent>
      <Pop delay={2}><Eyebrow><span style={{color: colors.mint}}>03 · Render explicitly</span></Eyebrow></Pop>
      <Pop delay={8}><BigText style={{fontSize: portrait ? 82 : 90, marginTop: 28, color: colors.white}}>One query.<br />The dialect you choose.</BigText></Pop>
      <div style={{marginTop: portrait ? 120 : 76, display: 'grid', gridTemplateColumns: portrait ? '1fr' : '1fr 1fr', gap: 30}}>
        {[
          ['Standard / SQLite', 'WHERE ("users"."id" = ?)', '[42]'],
          ['PostgreSQL', 'WHERE ("users"."id" = $1)', '[42]'],
        ].map(([label, sql, params], index) => (
          <Pop key={label} delay={20 + index * 14}>
            <div style={{background: colors.white, color: colors.ink, borderRadius: 28, padding: portrait ? 48 : 42, boxShadow: shadow}}>
              <div style={{fontSize: 21, color: colors.blue, fontWeight: 750, textTransform: 'uppercase', letterSpacing: '.12em'}}>{label}</div>
              <div style={{fontFamily: mono, fontSize: portrait ? 29 : 27, marginTop: 34, lineHeight: 1.5}}>{sql}</div>
              <div style={{fontFamily: mono, fontSize: 23, color: colors.muted, marginTop: 20}}>parameters: {params}</div>
              <div style={{height: 7, marginTop: 38, background: '#E3E1DB', borderRadius: 20, overflow: 'hidden'}}>
                <div style={{height: '100%', width: `${progress * 100}%`, background: index ? colors.coral : colors.mint}} />
              </div>
            </div>
          </Pop>
        ))}
      </div>
      <Pop delay={46} style={{marginTop: portrait ? 80 : 58}}>
        <div style={{fontSize: portrait ? 32 : 29, color: '#DDE5FF'}}>Values stay bound. Identifier quoting and placeholders stay visible.</div>
      </Pop>
    </Shell>
  );
};

const BoundaryScene = () => {
  const {width, height} = useVideoConfig();
  const portrait = height > width;
  const flow = ['typed query', 'SQL + parameters', 'your driver'];
  return (
    <Shell dark>
      <Pop delay={4}><Eyebrow>Small core. Clear boundary.</Eyebrow></Pop>
      <Pop delay={10}><BigText style={{fontSize: portrait ? 84 : 94, marginTop: 28}}>Qubu builds SQL.<br /><span style={{color: colors.mint}}>You own execution.</span></BigText></Pop>
      <div style={{display: 'flex', flexDirection: portrait ? 'column' : 'row', alignItems: 'stretch', marginTop: portrait ? 130 : 100, gap: portrait ? 24 : 0}}>
        {flow.map((item, index) => (
          <Pop key={item} delay={24 + index * 14} style={{display: 'flex', flex: 1, flexDirection: portrait ? 'column' : 'row', alignItems: 'center'}}>
            <div style={{width: '100%', boxSizing: 'border-box', border: '2px solid #3A3D3B', borderRadius: 24, padding: portrait ? 44 : '48px 30px', textAlign: 'center', fontFamily: mono, fontSize: portrait ? 30 : 27, background: '#202321'}}>{item}</div>
            {index < flow.length - 1 && <div style={{fontSize: 42, color: colors.blue, padding: portrait ? '10px 0' : '0 20px', transform: portrait ? 'rotate(90deg)' : undefined}}>→</div>}
          </Pop>
        ))}
      </div>
      <Pop delay={64} style={{marginTop: portrait ? 90 : 66}}>
        <div style={{color: '#A7AAA7', fontSize: portrait ? 30 : 27}}>No connection pool. No hidden queries. No relationship layer.</div>
      </Pop>
    </Shell>
  );
};

const Finale = () => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const portrait = height > width;
  const orbit = interpolate(frame, [0, 150], [0, 360]);
  return (
    <Shell>
      <div style={{height: '100%', display: 'grid', placeItems: 'center', textAlign: 'center'}}>
        <div>
          <Pop delay={4} style={{display: 'flex', justifyContent: 'center'}}><Wordmark /></Pop>
          <Pop delay={12}><BigText style={{fontSize: portrait ? 110 : 126, marginTop: 56}}>SQL, composed<br /><span style={{color: colors.blue}}>as TypeScript values.</span></BigText></Pop>
          <Pop delay={26}>
            <div style={{marginTop: 58, display: 'inline-flex', alignItems: 'center', gap: 18, borderRadius: 100, padding: '20px 32px', background: colors.ink, color: colors.white, fontFamily: mono, fontSize: portrait ? 27 : 25}}>
              <span style={{color: colors.mint}}>$</span> npm install qubu
            </div>
          </Pop>
        </div>
      </div>
      <div style={{position: 'absolute', width: portrait ? 520 : 700, height: portrait ? 520 : 700, border: `2px solid ${colors.blue}`, borderRadius: '50%', opacity: 0.15, right: portrait ? -300 : -250, top: portrait ? -250 : -360, transform: `rotate(${orbit}deg)`}}>
        <div style={{width: 34, height: 34, borderRadius: 30, background: colors.coral, position: 'absolute', left: '48%', bottom: -17}} />
      </div>
    </Shell>
  );
};

export const QubuIntro = () => (
  <AbsoluteFill style={{fontFamily}}>
    <Sequence durationInFrames={150}><Opening /></Sequence>
    <Sequence from={150} durationInFrames={190}><QueryScene /></Sequence>
    <Sequence from={340} durationInFrames={180}><TypeScene /></Sequence>
    <Sequence from={520} durationInFrames={170}><RenderScene /></Sequence>
    <Sequence from={690} durationInFrames={115}><BoundaryScene /></Sequence>
    <Sequence from={805} durationInFrames={95}><Finale /></Sequence>
  </AbsoluteFill>
);
