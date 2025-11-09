import { pgTable, text, uuid } from 'qubu'

export const users = pgTable('users', {
  id: uuid().primaryKey(),
  name: text(),
})

export const posts = pgTable('posts', {
  id: uuid().primaryKey(),
  body: text().notNull(),
  authorId: uuid()
    .notNull()
    .references(() => users.id),
})
