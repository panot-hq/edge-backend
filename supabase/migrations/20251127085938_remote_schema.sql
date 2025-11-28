

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (user_id)
  values (new.id);
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_my_contact"("c_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$select exists(
    select 1 from contacts c
    where c.id = c_id and c.owner_id = (SELECT auth.uid())
  );$$;


ALTER FUNCTION "public"."is_my_contact"("c_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "communication_channels" json,
    "deleted" boolean DEFAULT false,
    "details" json
);


ALTER TABLE "public"."contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."interactions" (
    "raw_content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "contact_id" "uuid",
    "owner_id" "uuid" NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted" boolean DEFAULT false,
    "processed" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."interactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "user_id" "uuid" NOT NULL,
    "onboarding_done" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted" boolean DEFAULT false,
    "subscribed" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."semantic_edges" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "source_id" "uuid" NOT NULL,
    "target_id" "uuid" NOT NULL,
    "relation_type" "text" NOT NULL,
    "weight" double precision DEFAULT 1.0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."semantic_edges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."semantic_nodes" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."semantic_nodes" OWNER TO "postgres";


ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."interactions"
    ADD CONSTRAINT "interactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."semantic_edges"
    ADD CONSTRAINT "semantic_edges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."semantic_nodes"
    ADD CONSTRAINT "semantic_nodes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."semantic_nodes"
    ADD CONSTRAINT "semantic_nodes_user_id_label_type_key" UNIQUE ("user_id", "label", "type");



CREATE INDEX "contacts_owner_idx" ON "public"."contacts" USING "btree" ("owner_id");



CREATE INDEX "idx_contacts_deleted" ON "public"."contacts" USING "btree" ("deleted") WHERE ("deleted" = false);



CREATE INDEX "idx_contacts_owner_updated" ON "public"."contacts" USING "btree" ("owner_id", "updated_at");



CREATE INDEX "idx_contacts_updated_at" ON "public"."contacts" USING "btree" ("updated_at");



CREATE INDEX "idx_interactions_deleted" ON "public"."interactions" USING "btree" ("deleted") WHERE ("deleted" = false);



CREATE INDEX "idx_interactions_owner_updated" ON "public"."interactions" USING "btree" ("owner_id", "updated_at");



CREATE INDEX "idx_interactions_updated_at" ON "public"."interactions" USING "btree" ("updated_at");



CREATE INDEX "idx_profiles_deleted" ON "public"."profiles" USING "btree" ("deleted") WHERE ("deleted" = false);



CREATE INDEX "idx_profiles_updated_at" ON "public"."profiles" USING "btree" ("updated_at");



CREATE OR REPLACE TRIGGER "trg_contacts_updated_at" BEFORE UPDATE ON "public"."contacts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "update_contacts_updated_at" BEFORE UPDATE ON "public"."contacts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_interactions_updated_at" BEFORE UPDATE ON "public"."interactions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."interactions"
    ADD CONSTRAINT "interactions_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."interactions"
    ADD CONSTRAINT "interactions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("user_id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."semantic_edges"
    ADD CONSTRAINT "semantic_edges_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "public"."semantic_nodes"("id");



ALTER TABLE ONLY "public"."semantic_edges"
    ADD CONSTRAINT "semantic_edges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."semantic_nodes"
    ADD CONSTRAINT "semantic_nodes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



CREATE POLICY "Users can delete their own contacts" ON "public"."contacts" FOR DELETE USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "Users can delete their own interactions" ON "public"."interactions" FOR DELETE USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "Users can insert their own contacts" ON "public"."contacts" FOR INSERT WITH CHECK (("auth"."uid"() = "owner_id"));



CREATE POLICY "Users can insert their own edges" ON "public"."semantic_edges" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own interactions" ON "public"."interactions" FOR INSERT WITH CHECK (("auth"."uid"() = "owner_id"));



CREATE POLICY "Users can insert their own nodes" ON "public"."semantic_nodes" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own profile" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own contacts" ON "public"."contacts" FOR UPDATE USING (("auth"."uid"() = "owner_id")) WITH CHECK (("auth"."uid"() = "owner_id"));



CREATE POLICY "Users can update their own interactions" ON "public"."interactions" FOR UPDATE USING (("auth"."uid"() = "owner_id")) WITH CHECK (("auth"."uid"() = "owner_id"));



CREATE POLICY "Users can update their own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own contacts" ON "public"."contacts" FOR SELECT USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "Users can view their own edges" ON "public"."semantic_edges" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own interactions" ON "public"."interactions" FOR SELECT USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "Users can view their own nodes" ON "public"."semantic_nodes" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own non-deleted interactions" ON "public"."interactions" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "owner_id") AND (("deleted" = false) OR ("deleted" IS NULL))));



CREATE POLICY "Users can view their own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."contacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."interactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_delete_me" ON "public"."profiles" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "profiles_insert_me" ON "public"."profiles" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "profiles_select_me" ON "public"."profiles" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "profiles_update_me" ON "public"."profiles" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."semantic_edges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."semantic_nodes" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."contacts";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."interactions";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."profiles";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_my_contact"("c_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_my_contact"("c_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_my_contact"("c_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";


















GRANT ALL ON TABLE "public"."contacts" TO "anon";
GRANT ALL ON TABLE "public"."contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."contacts" TO "service_role";



GRANT ALL ON TABLE "public"."interactions" TO "anon";
GRANT ALL ON TABLE "public"."interactions" TO "authenticated";
GRANT ALL ON TABLE "public"."interactions" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."semantic_edges" TO "anon";
GRANT ALL ON TABLE "public"."semantic_edges" TO "authenticated";
GRANT ALL ON TABLE "public"."semantic_edges" TO "service_role";



GRANT ALL ON TABLE "public"."semantic_nodes" TO "anon";
GRANT ALL ON TABLE "public"."semantic_nodes" TO "authenticated";
GRANT ALL ON TABLE "public"."semantic_nodes" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






























