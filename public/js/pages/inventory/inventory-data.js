(function initStockCheckDataModule(global) {
  async function getAccessToken(deps) {
    var sb = deps.getSb();
    if (!sb) throw new Error('Supabase not initialized');
    var session = await sb.auth.getSession();
    if (!session.data || !session.data.session) throw new Error('No active session');
    return session.data.session.access_token;
  }

  async function loadOrderItemChecks(deps) {
    var sb = deps.getSb();
    if (!sb) throw new Error('Supabase client not available');
    var result = await sb
      .from('order_item_stock_checks')
      .select('id,order_id,order_item_id,store_id,product_code,description,requested_quantity,stock_status,available_quantity,checked_by,checked_at,notes,created_at,updated_at,lojas(id,codigo,nome)')
      .order('created_at', { ascending: false });
    if (result.error) throw result.error;
    return result.data || [];
  }

  async function loadReceivedStock(deps) {
    var sb = deps.getSb();
    if (!sb) throw new Error('Supabase client not available');
    var result = await sb
      .from('store_stock_receipts')
      .select('id,order_id,order_item_id,order_receipt_id,store_id,product_code,description,received_quantity,unit,received_unit_value,received_total_value,received_by,received_at,created_at,lojas(id,codigo,nome),order_receipts!store_stock_receipts_order_receipt_id_fkey(invoice_number)')
      .is('voided_at', null)
      .order('received_at', { ascending: false })
      .limit(100);
    if (result.error) throw result.error;
    return result.data || [];
  }

  async function updateStockCheck(orderItemId, payload, deps) {
    var token = await getAccessToken(deps);
    var response = await fetch('/api/admin/stock-checks/' + encodeURIComponent(orderItemId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(payload),
    });
    var body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Erro ao atualizar verificação de estoque');
    return body;
  }

  async function updateReceivedStock(receiptId, payload, deps) {
    var token = await getAccessToken(deps);
    var response = await fetch('/api/admin/received-stock/' + encodeURIComponent(receiptId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(payload),
    });
    var body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Erro ao atualizar recibo');
    return body;
  }

  async function voidReceivedStock(receiptId, voidReason, deps) {
    var token = await getAccessToken(deps);
    var response = await fetch('/api/admin/received-stock/' + encodeURIComponent(receiptId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ voidReason: voidReason }),
    });
    var body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Erro ao anular recibo');
    return body;
  }

  global.StockCheckDataModule = {
    loadOrderItemChecks: loadOrderItemChecks,
    loadReceivedStock: loadReceivedStock,
    updateStockCheck: updateStockCheck,
    updateReceivedStock: updateReceivedStock,
    voidReceivedStock: voidReceivedStock,
  };
})(window);
