import {Composition} from 'remotion';
import {QubuIntro} from './QubuIntro';

const fps = 30;
const durationInFrames = 900;

export const RemotionRoot = () => (
  <>
    <Composition
      id="QubuIntroLandscape"
      component={QubuIntro}
      durationInFrames={durationInFrames}
      fps={fps}
      width={1920}
      height={1080}
    />
    <Composition
      id="QubuIntroPortrait"
      component={QubuIntro}
      durationInFrames={durationInFrames}
      fps={fps}
      width={1080}
      height={1920}
    />
  </>
);
