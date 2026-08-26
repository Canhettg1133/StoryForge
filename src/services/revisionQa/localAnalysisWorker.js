import { expose } from 'comlink';
import { analyzeLocalManuscript } from './localAnalysis.js';

expose({ analyze: analyzeLocalManuscript });
