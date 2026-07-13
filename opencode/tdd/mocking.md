# Cuando mockear

Mockear solo en **limites de sistema**:

- APIs externas (pagos, email, etc.)
- Bases de datos (a veces; preferir una DB de test)
- Tiempo/aleatoriedad
- File system (a veces)

No mockear:

- Tus propias clases/modulos
- Colaboradores internos
- Cualquier cosa que controlas

## Disenar para mockeabilidad

En los limites de sistema, disenar interfaces faciles de mockear:

**1. Usar dependency injection**

Pasar las dependencias externas por parametro en vez de crearlas adentro:

```typescript
// Facil de mockear
function processPayment(order, paymentClient) {
  return paymentClient.charge(order.total);
}

// Dificil de mockear
function processPayment(order) {
  const client = new StripeClient(process.env.STRIPE_KEY);
  return client.charge(order.total);
}
```

**2. Preferir interfaces estilo SDK sobre fetchers genericos**

Crear funciones especificas por operacion externa en vez de una funcion generica con logica condicional:

```typescript
// GOOD: cada funcion es mockeable por separado
const api = {
  getUser: (id) => fetch(`/users/${id}`),
  getOrders: (userId) => fetch(`/users/${userId}/orders`),
  createOrder: (data) => fetch('/orders', { method: 'POST', body: data }),
};

// BAD: mockear exige logica condicional adentro del mock
const api = {
  fetch: (endpoint, options) => fetch(endpoint, options),
};
```

El enfoque SDK significa:

- Cada mock devuelve una forma especifica
- Cero logica condicional en el setup del test
- Se ve facil que endpoints ejercita cada test
- Type safety por endpoint
