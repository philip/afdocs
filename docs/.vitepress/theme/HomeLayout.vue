<script setup>
import DefaultTheme from 'vitepress/theme';
import HeroScorecard from './components/HeroScorecard.vue';
import LlmsDirective from './components/LlmsDirective.vue';
import CopyPageButton from './components/CopyPageButton.vue';
</script>

<template>
  <DefaultTheme.Layout>
    <template #home-hero-image>
      <HeroScorecard />
    </template>
    <template #layout-top>
      <LlmsDirective />
    </template>
    <template #doc-before>
      <CopyPageButton />
    </template>
  </DefaultTheme.Layout>
</template>
