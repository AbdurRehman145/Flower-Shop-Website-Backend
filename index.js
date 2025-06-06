const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

app.get("/products", async (req, res) => {
  const { data, error } = await supabase
    .from("products")
    .select("*");

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get("/products/:id", async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return res.status(404).json({ error: error.message });
  res.json(data);
});

app.get("/products/filter", async (req, res) => {
  let query = supabase.from("products").select("*");

  const { category, instock, minPrice, maxPrice, sort } = req.query;

  if (category) {
    query = query.eq("category", category);
  }

  if (instock !== undefined) {
    const inStockBool = instock === "true";
    query = query.eq("instock", inStockBool);
  }

  if (minPrice) {
    query = query.gte("price", parseFloat(minPrice));
  }

  if (maxPrice) {
    query = query.lte("price", parseFloat(maxPrice));
  }

  if (sort === "price_asc") {
    query = query.order("price", { ascending: true });
  } else if (sort === "price_desc") {
    query = query.order("price", { ascending: false });
  }

  const { data, error } = await query;

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/products/search', async (req, res) => {
  const { name } = req.query;

  let data, error;

  if(!name){
    ({data, error}  = await supabase.from("products").select("*"));
  }
  else {
    ({data, error} = await supabase.from("products").select("*").ilike("name", `%${name}%`));
  }

  if(error) return res.status(500).json({error: error.messsage});
  res.json(data);

});


app.post("/products", async (req, res) => {
  const { name, category, price, instock } = req.body;

  if (!name || !category || price === undefined || instock === undefined) {
    return res.status(400).json({ error: "Missing product fields." });
  }

  const { data, error } = await supabase
    .from("products")
    .insert([{ name, category, price, instock }]);

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ message: "Product added", product: data[0] });
});


app.put("/updateProducts/:id", async (req, res) => {
  const { id } = req.params;
  const { name, category, price, instock } = req.body;

  const updateFields = {};
  if (name !== undefined) updateFields.name = name;
  if (category !== undefined) updateFields.category = category;
  if (price !== undefined) updateFields.price = price;
  if (instock !== undefined) updateFields.instock = instock;

  const { data, error } = await supabase
    .from("products")
    .update(updateFields)
    .eq("id", id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: "Product updated", product: data[0] });
});


app.delete("/products/:id", async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: "Product deleted" });
});

const nodemailer = require("nodemailer");

app.post("/orders", async (req, res) => {
  const { customer, order, items } = req.body;

  try {
    // 1. Insert or get existing customer by email
    const { data: existingCustomer, error: customerFetchError } = await supabase
      .from("customers")
      .select("id")
      .eq("email", customer.email)
      .single();

    if (customerFetchError && customerFetchError.code !== 'PGRST116') {
      throw customerFetchError;
    }

    let customerId = existingCustomer?.id;

    if (!customerId) {
      const { data: insertedCustomer, error: insertCustomerError } = await supabase
        .from("customers")
        .insert([customer])
        .select()
        .single();

      if (insertCustomerError) throw insertCustomerError;
      customerId = insertedCustomer.id;
    }

    // 2. Insert the order
    const { data: newOrder, error: insertOrderError } = await supabase
      .from("orders")
      .insert([{ ...order, customer_id: customerId }])
      .select()
      .single();

    if (insertOrderError) throw insertOrderError;

    const orderId = newOrder.id;

    // 3. Insert order items
    const orderItems = items.map((item) => ({
      order_id: orderId,
      product_id: item.product_id,
      quantity: item.quantity,
      price: item.price,
      product_name: item.product_name
    }));

    const { error: insertItemsError } = await supabase
      .from("orderitems")
      .insert(orderItems);

    if (insertItemsError) throw insertItemsError;

    // 4. Send order confirmation email
    const transporter = nodemailer.createTransport({
      service: 'gmail', // or use SMTP details
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const orderSummaryHtml = `
      <h2>Order Confirmation</h2>
      <p>Order #: <strong>${order.order_number}</strong></p>
      <p>Estimated Delivery: ${order.estimated_delivery}</p>
      <p>Subtotal: $${order.subtotal}</p>
      <p>Shipping Fee: $${order.shipping_cost}</p>
      <p>Total: $${order.total_amount}</p>
      <h3>Items:</h3>
      <ul>
        ${items.map(i => `<li>${i.quantity} × ${i.product_name} - $${i.price}</li>`).join("")}
      </ul>
      <p>Shipping Address: ${customer.address}</p>
      <p>Contact: ${customer.phone}</p>
    `;

    const emailOptions = {
      from: process.env.EMAIL_USER,
      to: [customer.email, process.env.COMPANY_EMAIL],
      subject: `Order Confirmation - ${order.order_number}`,
      html: orderSummaryHtml,
    };

    await transporter.sendMail(emailOptions);

    res.status(201).json({ message: "Order placed and confirmation email sent!" });

  } catch (error) {
    console.error("Order submission failed:", error);
    res.status(500).json({ error: error.message || "Failed to process order." });
  }
});


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

