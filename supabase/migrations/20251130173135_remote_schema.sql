drop extension if exists "pg_net";

alter table "public"."semantic_edges" drop constraint "semantic_edges_target_id_fkey";

alter table "public"."semantic_nodes" add column "weight" integer default 1;

alter table "public"."semantic_edges" add constraint "semantic_edges_source_id_fkey" FOREIGN KEY (source_id) REFERENCES public.contacts(id) ON UPDATE CASCADE ON DELETE CASCADE not valid;

alter table "public"."semantic_edges" validate constraint "semantic_edges_source_id_fkey";

alter table "public"."semantic_edges" add constraint "semantic_edges_target_id_fkey" FOREIGN KEY (target_id) REFERENCES public.semantic_nodes(id) ON UPDATE CASCADE ON DELETE CASCADE not valid;

alter table "public"."semantic_edges" validate constraint "semantic_edges_target_id_fkey";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


