// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Page from '../src/routes/+page.svelte';

describe('home page shell', () => {
  it('renders the wordmark, privacy note, and heading', () => {
    render(Page);

    expect(screen.getByText('ProductPrep')).toBeInTheDocument();
    expect(screen.getByText('Your images never leave your device')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Make product photos ready for your store.' })
    ).toBeInTheDocument();
  });
});
