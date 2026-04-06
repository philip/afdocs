<script setup>
import DefaultTheme from 'vitepress/theme';
import HeroScorecard from './components/HeroScorecard.vue';
import LlmsDirective from './components/LlmsDirective.vue';
</script>

<template>
  <DefaultTheme.Layout>
    <template #home-hero-image>
      <HeroScorecard />
    </template>
    <template #layout-top>
      <LlmsDirective />
    </template>
  </DefaultTheme.Layout>
</template>
