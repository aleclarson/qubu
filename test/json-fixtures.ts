import {
  from,
  json,
  jsonExists,
  jsonPath,
  jsonText,
  select,
  table,
} from '../src/index.ts'

export const events = table('events', {
  payload: json<{ user?: { name?: string } }>(),
})

export const query = select(
  {
    name: jsonText(events.payload, jsonPath('user', 'name')),
    hasUser: jsonExists(events.payload, jsonPath('user')),
  },
  from(events)
)
