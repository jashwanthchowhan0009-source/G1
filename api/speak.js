import { tts as speak } from '../server/handlers.js';

export default {
  fetch(request) {
    return speak(request, process.env);
  },
};
