import * as pgtmp from "@pg-nano/pg-tmp";
import { connect } from "pg-socket";
import {
  and,
  from,
  isEqual,
  isNotNull,
  orderBy,
  pgTable,
  select,
  sql,
  text,
  uuid,
  where,
} from "yiss";

const client = await connect(await pgtmp.start());

const User = pgTable("user", {
  id: uuid().primaryKey(),
  name: text(),
});

const dumbUser = User.as("dumb_user");

User.id;
dumbUser.id;

sql(
  select({
    id: dumbUser.id,
    name: dumbUser.name,
  }),
  from(dumbUser),
  where(
    isEqual(dumbUser.id, 1),
    and(dumbUser.name, isNotNull()),
    and(dumbUser.name, isNotNull())
  ),
  orderBy(dumbUser.id.asc())
).toQuery(client);
