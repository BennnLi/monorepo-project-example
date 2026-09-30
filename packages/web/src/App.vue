<script setup lang="ts">
import { ref, onMounted } from 'vue';

const message = ref('');
const health = ref('checking...');
const count = ref(0);

interface ApiResponse {
    message?: string;
    status?: string;
}

const fetchHello = async () => {
    try {
        const res = await fetch('/api/hello');
        const data: ApiResponse = (await res.json()) as ApiResponse;
        message.value = data.message ?? '';
    } catch {
        message.value = 'Failed to connect to server';
    }
};

const checkHealth = async () => {
    try {
        const res = await fetch('/api/health');
        const data: ApiResponse = (await res.json()) as ApiResponse;
        health.value = data.status ?? '';
    } catch {
        health.value = 'unreachable';
    }
};

onMounted(() => {
    void fetchHello();
    void checkHealth();
});
</script>

<template>
    <div class="container">
        <h1>🚀 MonorepoTest</h1>
        <p class="subtitle">Vite + Vue 3 + TypeScript</p>

        <div class="card">
            <h2>Server Status</h2>
            <p>
                Health:
                <span :class="health === 'ok' ? 'badge-ok' : 'badge-err'">{{ health }}</span>
            </p>
            <p>Message: {{ message || 'loading...' }}</p>
            <button @click="fetchHello">Refresh</button>
        </div>

        <div class="card">
            <h2>Counter</h2>
            <p class="count">{{ count }}</p>
            <button @click="count++">+1</button>
            <button style="margin-left: 8px" @click="count = 0">Reset</button>
        </div>
    </div>
</template>

<style scoped>
.container {
    max-width: 600px;
    margin: 60px auto;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #213547;
}

h1 {
    font-size: 2rem;
    margin-bottom: 4px;
}

.subtitle {
    color: #888;
    margin-bottom: 32px;
}

.card {
    background: #f9f9f9;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 16px;
}

.count {
    font-size: 2rem;
    font-weight: bold;
}

button {
    padding: 8px 16px;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: #fff;
    cursor: pointer;
    font-size: 14px;
}

button:hover {
    background: #f0f0f0;
}

.badge-ok {
    color: green;
    font-weight: bold;
}

.badge-err {
    color: red;
    font-weight: bold;
}
</style>
