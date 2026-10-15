alter table public.lojas
    add column if not exists cidade text,
    add column if not exists estado varchar(2);
