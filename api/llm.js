import { chat as llm } from '../server/handlers.js';

export default {
  fetch(request) {
    return llm(request, process.env);
  },
};
