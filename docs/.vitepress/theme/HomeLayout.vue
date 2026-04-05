<script setup>
import DefaultTheme from "vitepress/theme";
import HeroScorecard from "./components/HeroScorecard.vue";
import LlmsDirective from "./components/LlmsDirective.vue";
</script>

<template>
  <DefaultTheme.Layout>
    <template #home-hero-image>
      <HeroScorecard />
    </template>
    <template #home-hero-before>
      <LlmsDirective />
    </template>
    <template #doc-before>
      <LlmsDirective />
    </template>
    <template #page-top>
      <LlmsDirective />
    </template>
  </DefaultTheme.Layout>
</template>
