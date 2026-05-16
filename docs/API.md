# SubNation2 API Documentation

## Base URL

- Production: `https://subnation.ly/api`
- Development: `http://localhost:3001/api`

## Authentication

Most endpoints require authentication via JWT token. The token should be:

- Stored in an httpOnly cookie named `auth_token` (preferred)
- Or sent in the Authorization header as `Bearer <token>` (fallback)

## Response Format

All responses follow this structure:

```json
{
  "data": { ... },
  "error": "error message" // only present on errors
}
```

## Rate Limiting

- Auth endpoints: 5 requests per 15 minutes per IP
- API endpoints: 100 requests per 15 minutes per user

---

## Authentication

### Register

```http
POST /auth/register
Content-Type: application/json

{
  "phone": "0911234567",
  "password": "password123",
  "referral_code": "ABC123" // optional
}
```

**Response:**

```json
{
  "success": true,
  "message": "تم إنشاء الحساب بنجاح",
  "token": "jwt_token_here"
}
```

### Login

```http
POST /auth/login
Content-Type: application/json

{
  "phone": "0911234567",
  "password": "password123"
}
```

**Response:**

```json
{
  "success": true,
  "token": "jwt_token_here"
}
```

### Logout

```http
POST /auth/logout
Authorization: Bearer <token>
```

**Response:**

```json
{
  "success": true,
  "message": "تم تسجيل الخروج بنجاح"
}
```

### Forgot Password

```http
POST /auth/forgot-password
Content-Type: application/json

{
  "phone": "0911234567"
}
```

**Response:**

```json
{
  "success": true,
  "message": "تم إرسال رمز الاستعادة"
}
```

### Reset Password

```http
POST /auth/reset-password
Content-Type: application/json

{
  "phone": "0911234567",
  "otp": "123456",
  "new_password": "newpassword123"
}
```

**Response:**

```json
{
  "success": true,
  "token": "new_jwt_token_here"
}
```

### Firebase Session

```http
POST /auth/firebase/session
Content-Type: application/json

{
  "id_token": "firebase_id_token"
}
```

**Response:**

```json
{
  "success": true,
  "token": "jwt_token_here"
}
```

---

## User

### Get Current User

```http
GET /me
Authorization: Bearer <token>
```

**Response:**

```json
{
  "id": 1,
  "phone": "0911234567",
  "balance": 50.0,
  "loyalty_points": 100,
  "created_at": "2024-01-01T00:00:00Z"
}
```

### Update Profile

```http
PUT /me
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "User Name"
}
```

**Response:**

```json
{
  "success": true,
  "message": "تم تحديث الملف الشخصي"
}
```

---

## Products

### List Products

```http
GET /products?category=digital&active=true
```

**Query Parameters:**

- `category` (optional): Filter by category
- `active` (optional): Filter by active status (true/false)
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20)

**Response:**

```json
{
  "products": [
    {
      "id": 1,
      "name": "Product Name",
      "description": "Product description",
      "price": 10.0,
      "category": "digital",
      "is_active": true,
      "created_at": "2024-01-01T00:00:00Z"
    }
  ],
  "total": 100,
  "page": 1,
  "limit": 20
}
```

### Get Product

```http
GET /products/:id
```

**Response:**

```json
{
  "id": 1,
  "name": "Product Name",
  "description": "Product description",
  "price": 10.0,
  "category": "digital",
  "is_active": true,
  "created_at": "2024-01-01T00:00:00Z"
}
```

---

## Orders

### Create Order

```http
POST /orders
Authorization: Bearer <token>
Content-Type: application/json

{
  "product_id": 1,
  "quantity": 2
}
```

**Response:**

```json
{
  "id": 123,
  "product_id": 1,
  "quantity": 2,
  "total": 20.0,
  "status": "pending",
  "created_at": "2024-01-01T00:00:00Z"
}
```

### List Orders

```http
GET /orders
Authorization: Bearer <token>
```

**Response:**

```json
{
  "orders": [
    {
      "id": 123,
      "product_id": 1,
      "quantity": 2,
      "total": 20.0,
      "status": "completed",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Get Order

```http
GET /orders/:id
Authorization: Bearer <token>
```

**Response:**

```json
{
  "id": 123,
  "product_id": 1,
  "quantity": 2,
  "total": 20.0,
  "status": "completed",
  "created_at": "2024-01-01T00:00:00Z"
}
```

---

## Wallet

### Get Balance

```http
GET /wallet
Authorization: Bearer <token>
```

**Response:**

```json
{
  "balance": 50.0,
  "currency": "LYD"
}
```

### Add Funds

```http
POST /wallet/topup
Authorization: Bearer <token>
Content-Type: application/json

{
  "amount": 50.00,
  "method": "card"
}
```

**Response:**

```json
{
  "success": true,
  "balance": 100.0,
  "transaction_id": "txn_123456"
}
```

### List Transactions

```http
GET /wallet/transactions
Authorization: Bearer <token>
```

**Response:**

```json
{
  "transactions": [
    {
      "id": "txn_123456",
      "amount": 50.0,
      "type": "topup",
      "status": "completed",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

## Referrals

### Get Referral Code

```http
GET /referrals/code
Authorization: Bearer <token>
```

**Response:**

```json
{
  "code": "ABC123",
  "bonus_amount": 5.0,
  "total_earnings": 25.0
}
```

### List Referrals

```http
GET /referrals
Authorization: Bearer <token>
```

**Response:**

```json
{
  "referrals": [
    {
      "id": 1,
      "referred_phone": "0927654321",
      "bonus_earned": 5.0,
      "created_at": "2024-01-01T00:00:00Z"
    }
  ],
  "total_earnings": 25.0
}
```

---

## Support

### Create Ticket

```http
POST /support/tickets
Authorization: Bearer <token>
Content-Type: application/json

{
  "subject": "Issue subject",
  "message": "Issue description"
}
```

**Response:**

```json
{
  "id": 456,
  "subject": "Issue subject",
  "status": "open",
  "created_at": "2024-01-01T00:00:00Z"
}
```

### List Tickets

```http
GET /support/tickets
Authorization: Bearer <token>
```

**Response:**

```json
{
  "tickets": [
    {
      "id": 456,
      "subject": "Issue subject",
      "status": "open",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

## Error Codes

| Code | Description                             |
| ---- | --------------------------------------- |
| 400  | Bad Request - Invalid input             |
| 401  | Unauthorized - Missing or invalid token |
| 403  | Forbidden - Insufficient permissions    |
| 404  | Not Found - Resource doesn't exist      |
| 429  | Too Many Requests - Rate limit exceeded |
| 500  | Internal Server Error - Server error    |

---

## Webhooks

### Order Status Update

Webhook URL configured in Render dashboard.

**Payload:**

```json
{
  "event": "order.status_changed",
  "data": {
    "order_id": 123,
    "status": "completed",
    "updated_at": "2024-01-01T00:00:00Z"
  }
}
```
