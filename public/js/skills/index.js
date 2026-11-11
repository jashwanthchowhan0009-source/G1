// Everything G1 can do, as one registry. The same skills serve the AI brain and basic mode.

import { commSkills } from './comm.js';
import { lifeSkills } from './life.js';
import { worldSkills } from './world.js';
import { createSkills_ } from './create.js';

export function createSkills() {
  const all = [...commSkills, ...lifeSkills, ...worldSkills, ...createSkills_];
  const byName = new Map(all.map((s) => [s.name, s]));
  return {
    get: (name) => byName.get(name),
    names: () => [...byName.keys()],
    /** Tool definitions in the OpenAI chat-completions format. */
    toolSchemas: () => all.map((s) => ({ type: 'function', function: { name: s.name, description: s.description, parameters: s.parameters } })),
  };
}
