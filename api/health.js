import { health } from '../server/handlers.js';

export default {
  fetch(request) {
    return health(request, process.env);
  },
};
