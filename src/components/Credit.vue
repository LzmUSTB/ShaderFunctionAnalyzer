<script setup lang="ts">
import BlogIcon from './svgs/BlogIcon.vue';
import Claude from './svgs/Claude.vue';
import Github from './svgs/Github.vue';

</script>

<template>
    <div class="credit-frame">
        <div class="icon-row">
            <BlogIcon />
            <Github />
            <Claude />
        </div>
        <div class="credit">
            <p>@AmazingWawa</p>
            <p>made with Claude code</p>
        </div>
    </div>
</template>

<style scoped>
.credit-frame {
    padding: 0.5em;
    color: #212121;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 1em;
}

.icon-row {
    font-size: 2em;
    display: flex;
    gap: 0.5em;
    align-items: center;
}

.credit {
    font-size: 0.3em;
}
</style>