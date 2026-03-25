// src/global.d.ts
interface Window {
  SpeechRecognition: any;
  webkitSpeechRecognition: any;
}

declare var SpeechRecognition: {
  prototype: any;
  new (): any;
};

declare var webkitSpeechRecognition: {
  prototype: any;
  new (): any;
};