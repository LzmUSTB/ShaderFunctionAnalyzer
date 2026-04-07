<script setup lang="ts">
import AppIcon from './svgs/AppIcon.vue';
import BlogIcon from './svgs/BlogIcon.vue';
import Claude from './svgs/Claude.vue';
import Github from './svgs/Github.vue';

</script>

<template>
    <div class="credit-frame">
        <div class="icon-row">
            <div class="icon-container">
                <AppIcon />
            </div>
            <a href="https://amazingwawa.com/" target="_blank" rel="noopener noreferrer">
                <BlogIcon />
            </a>
            <a href="https://github.com/LzmUSTB/ShaderFunctionAnalyzer" target="_blank" rel="noopener noreferrer">
                <Github />
            </a>
            <a href="https://claude.com/product/claude-code" target="_blank" rel="noopener noreferrer">
                <Claude />
            </a>
        </div>
        <div class="credit">
            <p>Shader Analyzer v0.1</p>
        </div>
    </div>
</template>

<style scoped>
.icon-container {
    color: #212121;
    background-color: #212121;
    border: 1px solid #a5a5a5;
    display: flex;
    padding: 0.1em;
}

.credit-frame {
    padding: 0.1em 0;
    color: #212121;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.2em;
}

.icon-row {
    font-size: 2em;
    display: flex;
    gap: 0.2em;
    align-items: center;
}

.credit {
    display: flex;
    align-items: center;
    font-size: 0.3em;
    justify-self: end;
}
</style>