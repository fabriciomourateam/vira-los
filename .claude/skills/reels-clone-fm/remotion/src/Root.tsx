import {Composition} from 'remotion';
import {Reel2} from './Reel2';
import config from './data/config.json';
export const Root = () => (
  <Composition id="Reel2" component={Reel2} width={1080} height={1920} fps={25} durationInFrames={Math.round(config.duracaoS*25)} />
);
