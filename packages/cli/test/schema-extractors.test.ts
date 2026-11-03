import assert from "node:assert/strict";
import test from "node:test";
import { extractEntities } from "../src/analyzers/analysis/extractors/index.js";
import { DrizzleExtractor } from "../src/analyzers/analysis/extractors/drizzleExtractor.js";
import { MongooseExtractor } from "../src/analyzers/analysis/extractors/mongooseExtractor.js";
import { SQLSchemaExtractor } from "../src/analyzers/analysis/extractors/sqlSchemaExtractor.js";
import { TypeORMExtractor } from "../src/analyzers/analysis/extractors/typeormExtractor.js";

function scannedFile(path: string, content: string) {
  return {
    path,
    absolutePath: `/tmp/${path}`,
    extension: path.slice(path.lastIndexOf(".")),
    size: Buffer.byteLength(content),
    lines: content.split(/\r?\n/).length,
    content
  };
}

const names = (entities: Array<{ name: string }>) => entities.map((entity) => entity.name).sort();

// ------------------------------------------------------------------- TypeORM

const TYPEORM_USER = `
import { Entity, PrimaryGeneratedColumn, Column, OneToMany, ManyToMany, JoinTable } from "typeorm";
import { ArticleEntity } from "../article/article.entity";

@Entity('user')
export class UserEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ nullable: true }) bio: string;
  @Column() email: string;
  @ManyToMany(type => ArticleEntity)
  @JoinTable()
  favorites: ArticleEntity[];
  @OneToMany(type => ArticleEntity, article => article.author)
  articles: ArticleEntity[];
}
`;

const TYPEORM_ARTICLE = `
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany } from "typeorm";
import { UserEntity } from "../user/user.entity";
import { Comment } from "./comment.entity";

@Entity('article')
export class ArticleEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column() title: string;
  @Column({ default: "" }) body: string;
  @ManyToOne(type => UserEntity, user => user.articles)
  author: UserEntity;
  @OneToMany(() => Comment, (comment) => comment.article, { eager: true })
  comments: Comment[];
}

@Entity()
export class Comment {
  @PrimaryGeneratedColumn() id: number;
  @ManyToOne(() => ArticleEntity, (article) => article.comments)
  article: ArticleEntity;
}

export class NotAnEntity {
  @Column() ignored: string;
}
`;

test("TypeORMExtractor reads @Entity classes, columns and relation decorators", () => {
  const extractor = new TypeORMExtractor();
  const files = [
    scannedFile("src/user/user.entity.ts", TYPEORM_USER),
    scannedFile("src/article/article.entity.ts", TYPEORM_ARTICLE)
  ];

  assert.equal(extractor.canHandle(files), true);
  const entities = extractor.extract(files);

  // The "Entity" suffix is naming convention, and undecorated classes are skipped.
  assert.deepEqual(names(entities), ["Article", "Comment", "User"]);
  const user = entities.find((entity) => entity.name === "User");
  assert.deepEqual(user?.fields.filter((field) => !field.isRelation).map((field) => field.name), ["id", "bio", "email"]);
  assert.equal(user?.fields.find((field) => field.name === "bio")?.isOptional, true);
  assert.equal(user?.fields.find((field) => field.name === "email")?.isOptional, false);

  const article = entities.find((entity) => entity.name === "Article");
  const author = article?.fields.find((field) => field.name === "author");
  assert.deepEqual([author?.type, author?.isRelation, author?.isList], ["User", true, false]);

  const kinds = new Set(user?.relations.map((relation) => `${relation.from}>${relation.to}:${relation.kind}`));
  assert.ok(kinds.has("User>Article:one-to-many"));
  assert.ok(kinds.has("User>Article:many-to-many"));
  // ManyToOne makes the target the owner, and the same link from both sides is kept once.
  assert.equal(article?.relations.filter((relation) => relation.from === "User" && relation.kind === "one-to-many").length, 1);
  assert.ok(article?.relations.some((relation) => relation.from === "Article" && relation.to === "Comment"));
});

test("TypeORMExtractor does nothing without @Entity classes", () => {
  const extractor = new TypeORMExtractor();
  const files = [scannedFile("src/plain.ts", "export class Plain { @Column() a: string }\n")];

  assert.equal(extractor.canHandle(files), false);
  assert.deepEqual(extractor.extract(files), []);
});

// ------------------------------------------------------------------ Mongoose

const MONGOOSE_USER = `
import mongoose from 'mongoose'
const userSchema = mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  isAdmin: { type: Boolean, required: true, default: false },
}, { timestamps: true })
const User = mongoose.model('User', userSchema)
export default User
`;

const MONGOOSE_ORDER = `
import mongoose from 'mongoose'
const reviewSchema = mongoose.Schema({ comment: { type: String, required: true } })
const orderSchema = mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
  orderItems: [{
    name: { type: String, required: true },
    product: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Product' },
  }],
  reviews: [reviewSchema],
  tags: [String],
  total: Number,
})
const Order = mongoose.model('Order', orderSchema)
export default Order
`;

test("MongooseExtractor reads models, refs (direct and nested) and ignores sub-document schemas", () => {
  const extractor = new MongooseExtractor();
  const files = [
    scannedFile("backend/models/userModel.js", MONGOOSE_USER),
    scannedFile("backend/models/orderModel.js", MONGOOSE_ORDER)
  ];

  assert.equal(extractor.canHandle(files), true);
  const entities = extractor.extract(files);

  assert.deepEqual(names(entities), ["Order", "User"]);

  const order = entities.find((entity) => entity.name === "Order");
  const user = order?.fields.find((field) => field.name === "user");
  assert.deepEqual([user?.type, user?.isRelation, user?.isOptional], ["User", true, false]);
  assert.equal(order?.fields.find((field) => field.name === "tags")?.isList, true);
  assert.equal(order?.fields.find((field) => field.name === "total")?.type, "Number");
  assert.equal(order?.fields.find((field) => field.name === "orderItems")?.isList, true);

  // `user` ref: User owns many Orders. The ref inside orderItems points at Product,
  // which is not a model here, so it is dropped instead of inventing an entity.
  const relations = order?.relations.map((relation) => `${relation.from}>${relation.to}`);
  assert.deepEqual(relations, ["User>Order"]);
});

test("MongooseExtractor needs a model() call, not just an import of mongoose", () => {
  const extractor = new MongooseExtractor();
  const files = [scannedFile("src/db.js", "import mongoose from 'mongoose'\nawait mongoose.connect(url)\n")];

  assert.equal(extractor.canHandle(files), false);
});

// ------------------------------------------------------------------- Drizzle

const DRIZZLE_SCHEMA = `
import { pgTable, serial, text, integer, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  bio: text("bio"),
});

export const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  authorId: integer("author_id").references(() => users.id).notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
}));
`;

const DRIZZLE_CALLBACK = `
import { pgTable } from "drizzle-orm/pg-core";

export const Post = pgTable("post", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  title: t.varchar({ length: 256 }).notNull(),
  updatedAt: t.timestamp({ mode: "date" }).$onUpdateFn(() => new Date()),
}));
`;

test("DrizzleExtractor reads tables, columns, references() and relations()", () => {
  const extractor = new DrizzleExtractor();
  const files = [scannedFile("db/schema.ts", DRIZZLE_SCHEMA)];

  assert.equal(extractor.canHandle(files), true);
  const entities = extractor.extract(files);

  assert.deepEqual(names(entities), ["Post", "User"]);
  const post = entities.find((entity) => entity.name === "Post");
  const author = post?.fields.find((field) => field.name === "authorId");
  assert.deepEqual([author?.type, author?.isRelation, author?.isOptional], ["User", true, false]);
  assert.equal(post?.fields.find((field) => field.name === "title")?.type, "text");

  const user = entities.find((entity) => entity.name === "User");
  assert.equal(user?.fields.find((field) => field.name === "bio")?.isOptional, true);
  assert.equal(user?.fields.find((field) => field.name === "posts")?.isList, true);
  // references() and many() describe the same link; it is stored once.
  assert.equal(user?.relations.filter((relation) => relation.from === "User" && relation.to === "Post").length, 1);
});

test("DrizzleExtractor reads the callback form that receives the column builders", () => {
  const entities = new DrizzleExtractor().extract([scannedFile("packages/db/src/schema.ts", DRIZZLE_CALLBACK)]);

  assert.deepEqual(names(entities), ["Post"]);
  const fields = entities[0].fields;
  assert.deepEqual(fields.map((field) => field.name), ["id", "title", "updatedAt"]);
  assert.deepEqual(fields.map((field) => field.type), ["uuid", "varchar", "timestamp"]);
  assert.deepEqual(fields.map((field) => field.isOptional), [false, false, true]);
});

// ----------------------------------------------------------------- SQL schema

const SUPABASE_MIGRATION = `
-- Users, linked to Supabase auth
create table users (
  id uuid references auth.users not null primary key,
  full_name text,
  billing_address jsonb
);
/* comment with create table fake (id int) */
create table if not exists public.products (
  id text primary key,
  name text,
  metadata jsonb
);
create table "prices" (
  id text primary key,
  product_id text references products,
  unit_amount bigint not null,
  unique (id, product_id)
);
create table subscriptions (
  id text primary key,
  user_id uuid references users not null,
  price_id text,
  quantity integer default 1,
  constraint fk_price foreign key (price_id) references prices (id)
);
create table knex_migrations (id int);
`;

test("SQLSchemaExtractor reads CREATE TABLE columns and foreign keys from .sql files", () => {
  const extractor = new SQLSchemaExtractor();
  const files = [scannedFile("supabase/migrations/init.sql", SUPABASE_MIGRATION)];

  assert.equal(extractor.canHandle(files), true);
  const entities = extractor.extract(files);

  // Bookkeeping tables and tables named only inside comments are not entities.
  assert.deepEqual(names(entities), ["Price", "Product", "Subscription", "User"]);

  const subscription = entities.find((entity) => entity.name === "Subscription");
  assert.equal(subscription?.fields.find((field) => field.name === "user_id")?.type, "User");
  assert.equal(subscription?.fields.find((field) => field.name === "price_id")?.type, "Price");
  assert.equal(subscription?.fields.find((field) => field.name === "quantity")?.isOptional, true);
  assert.equal(subscription?.fields.find((field) => field.name === "user_id")?.isOptional, false);

  const price = entities.find((entity) => entity.name === "Price");
  assert.deepEqual(price?.fields.map((field) => field.name), ["id", "product_id", "unit_amount"]);

  // `references auth.users` on users.id points at itself and must not create a relation.
  const user = entities.find((entity) => entity.name === "User");
  assert.deepEqual(user?.relations.map((relation) => `${relation.from}>${relation.to}`), ["User>Subscription"]);
});

test("SQLSchemaExtractor singularizes join tables and ignores drop-only undo scripts", () => {
  const files = [
    scannedFile("migrations/001.do.users.sql", "CREATE TABLE users (id INT PRIMARY KEY);"),
    scannedFile("migrations/001.undo.users.sql", "DROP TABLE users;"),
    scannedFile("migrations/005.do.user_roles.sql", [
      "CREATE TABLE user_roles (",
      "  user_id INT NOT NULL,",
      "  role_id INT NOT NULL,",
      "  FOREIGN KEY (user_id) REFERENCES users(id)",
      ");"
    ].join("\n"))
  ];

  const entities = new SQLSchemaExtractor().extract(files);

  assert.deepEqual(names(entities), ["User", "UserRole"]);
  assert.equal(entities.find((entity) => entity.name === "UserRole")?.fields.find((field) => field.name === "user_id")?.type, "User");
});

test("SQLSchemaExtractor treats unique/key words as columns unless they start a constraint", () => {
  const entities = new SQLSchemaExtractor().extract([
    scannedFile("db/schema.sql", [
      "CREATE TABLE settings (",
      "  id INT PRIMARY KEY,",
      "  unique_code TEXT,",
      "  UNIQUE (unique_code),",
      "  CHECK (id > 0)",
      ");"
    ].join("\n"))
  ]);

  assert.deepEqual(entities[0].fields.map((field) => field.name), ["id", "unique_code"]);
});

// -------------------------------------------------------------- orchestrator

test("extractEntities prefers a real schema over query strings and over route hints", () => {
  const files = [
    scannedFile("migrations/001.do.users.sql", "create table users (id int primary key, email text not null);"),
    scannedFile("src/db.ts", 'import mysql from "mysql2";\nexport const q = () => db.query("SELECT * FROM audit_log");\n'),
    scannedFile("scripts/seed.ts", 'import mysql from "mysql2";\nexport const s = () => db.query("INSERT INTO roles (name) VALUES (?)");\n')
  ];
  const routes = [{ path: "/api/widgets", file: "src/routes/widgets.ts", kind: "api" as const, methods: ["GET"] }];

  const graph = extractEntities(files, routes);

  assert.equal(graph.source, "sql");
  assert.deepEqual(graph.entityNames, ["User"]);
  assert.ok(graph.entities[0].fields.length > 0);
});

test("extractEntities keeps relations from the extractor for foreign-key sources", () => {
  const graph = extractEntities([
    scannedFile("backend/models/userModel.js", MONGOOSE_USER),
    scannedFile("backend/models/orderModel.js", MONGOOSE_ORDER)
  ]);

  assert.equal(graph.source, "mongoose");
  assert.deepEqual(graph.relations, [{ from: "User", to: "Order", kind: "one-to-many" }]);
});

test("extractEntities still falls back to route hints when nothing declares a schema", () => {
  const graph = extractEntities(
    [scannedFile("src/index.ts", "export const a = 1;\n")],
    [{ path: "/api/widgets", file: "src/routes/widgets.ts", kind: "api" as const, methods: ["GET", "POST"] }]
  );

  assert.equal(graph.source, "route-hint");
  assert.deepEqual(graph.entityNames, ["Widget"]);
});
