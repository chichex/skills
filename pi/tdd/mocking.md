# Cuándo mockear

Mockear solo en **límites de sistema**:

- APIs externas (pagos, email, etc.)
- Bases de datos (a veces — preferir una DB de test)
- Tiempo/aleatoriedad
- File system (a veces)

No mockear:

- Tus propias clases/módulos
- Colaboradores internos
- Cualquier cosa que controlás

## Diseñar para mockeabilidad

En los límites de sistema, diseñar interfaces fáciles de mockear:

**1. Usar dependency injection**

Pasar las dependencias externas por parámetro en vez de crearlas adentro:

```typescript
// Fácil de mockear
function processPayment(order, paymentClient) {
  return paymentClient.charge(order.total);
}

// Difícil de mockear
function processPayment(order) {
  const client = new StripeClient(process.env.STRIPE_KEY);
  return client.charge(order.total);
}
```

**2. Preferir interfaces estilo SDK sobre fetchers genéricos**

Crear funciones específicas por operación externa en vez de una función genérica con lógica condicional:

```typescript
// GOOD: cada función es mockeable por separado
const api = {
  getUser: (id) => fetch(`/users/${id}`),
  getOrders: (userId) => fetch(`/users/${userId}/orders`),
  createOrder: (data) => fetch('/orders', { method: 'POST', body: data }),
};

// BAD: mockear exige lógica condicional adentro del mock
const api = {
  fetch: (endpoint, options) => fetch(endpoint, options),
};
```

El enfoque SDK significa:

- Cada mock devuelve una forma específica
- Cero lógica condicional en el setup del test
- Se ve fácil qué endpoints ejercita cada test
- Type safety por endpoint
