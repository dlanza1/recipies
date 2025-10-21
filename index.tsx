
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Firebase App (declared in HTML script)
declare var firebase: any; 

interface Recipe {
  id: string; // Firestore document ID
  name: string;
  ingredients: string;
  instructions: string;
  lastEatenDate: string | null;
  rating: number; // 0 for unrated, 1-5 for rated
}

const FIRESTORE_COLLECTION_NAME = 'recipes';
let recipes: Recipe[] = [];
let editingRecipeId: string | null = null;
let currentFormRating = 0;

const EMPTY_STAR = '☆';
const FULL_STAR = '★';

// DOM Elements
const recipeForm = document.getElementById('recipe-form');
const recipeNameInput = document.getElementById('recipe-name');
const recipeIngredientsInput = document.getElementById('recipe-ingredients');
const recipeInstructionsInput = document.getElementById('recipe-instructions');
const recipeRatingStarsContainer = document.getElementById('recipe-rating-stars');

const recipesContainer = document.getElementById('recipes-container');
const suggestRecipeBtn = document.getElementById('suggest-recipe-btn');
const suggestedRecipeDisplay = document.getElementById('suggested-recipe-display');

const formSectionHeading = document.getElementById('form-section-heading');
const formSubmitBtn = document.getElementById('form-submit-btn');
const cancelEditBtn = document.getElementById('cancel-edit-btn');

const INITIAL_SUGGESTIONS_COUNT = 5;
let showingAllSuggestions = false;

// Firestore instance
let db: any = null; 
try {
  if (typeof firebase !== 'undefined' && firebase.firestore) {
    db = firebase.firestore();
  } else {
    console.error("Firestore is not available. Firebase might not have been initialized correctly.");
    if(recipesContainer) recipesContainer.innerHTML = '<p style="color:red;">Error: Firestore is not available. Recipes cannot be loaded.</p>';
  }
} catch (e) {
    console.error("Error getting Firestore instance:", e);
    if(recipesContainer) recipesContainer.innerHTML = '<p style="color:red;">Error: Could not connect to Firestore. Recipes cannot be loaded.</p>';
}


// Utility Functions
function getCurrentDateString(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = (today.getMonth() + 1).toString().padStart(2, '0');
  const day = today.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function escapeHTML(str: string): string {
    const p = document.createElement("p");
    p.textContent = str;
    return p.innerHTML;
}

function displayStars(rating: number | undefined): string {
  if (rating === undefined || rating === 0) return '<span class="recipe-rating-display">Unrated</span>';
  let stars = '';
  for (let i = 1; i <= 5; i++) {
    stars += i <= rating ? FULL_STAR : EMPTY_STAR;
  }
  return `<span class="recipe-rating-display">${stars}</span>`;
}

function calculateDaysAgo(dateString: string | null): string {
  if (!dateString) return "Not eaten yet.";
  const today = new Date();
  const eatenDate = new Date(dateString);
  today.setHours(0, 0, 0, 0);
  eatenDate.setHours(0, 0, 0, 0);
  const diffTime = today.getTime() - eatenDate.getTime();
  if (diffTime < 0) return "(Future date)";
  const days = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  if (days === 0) return "(Today)";
  if (days === 1) return "(Yesterday)";
  return `(${days} days ago)`;
}

function calculateDaysAgoForSuggestion(dateString: string | null): string {
    if (!dateString) return "(Never eaten)";
    const today = new Date();
    const eatenDate = new Date(dateString);
    today.setHours(0, 0, 0, 0);
    eatenDate.setHours(0, 0, 0, 0);
    const diffTime = today.getTime() - eatenDate.getTime();
    if (diffTime < 0) return "(Future date)";
    const days = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    if (days === 0) return "(Eaten today)";
    if (days === 1) return "(Eaten yesterday)";
    return `(Eaten ${days} days ago)`;
}

// Firestore Functions
async function loadRecipesFromFirestore(): Promise<void> {
  if (!db) {
    if(recipesContainer) recipesContainer.innerHTML = '<p>Error: Database not connected. Cannot load recipes.</p>';
    return;
  }
  if(recipesContainer) recipesContainer.innerHTML = '<p>Loading recipes...</p>';
  try {
    const snapshot = await db.collection(FIRESTORE_COLLECTION_NAME).orderBy("name").get();
    recipes = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    renderRecipes();
    showingAllSuggestions = false;
    handleSuggestRecipe();
  } catch (error) {
    console.error("Error loading recipes from Firestore:", error);
    if(recipesContainer) recipesContainer.innerHTML = '<p style="color:red;">Could not load recipes. Check console for details.</p>';
  }
}

async function addRecipeToFirestore(recipeData: Omit<Recipe, 'id'>): Promise<void> {
  if (!db) {
    alert('Error: Database not connected. Cannot save recipe.');
    return;
  }
  try {
    const docRef = await db.collection(FIRESTORE_COLLECTION_NAME).add(recipeData);
    const newRecipe = { id: docRef.id, ...recipeData };
    recipes.push(newRecipe); // Optimistically update local array
    recipes.sort((a, b) => a.name.localeCompare(b.name)); // Keep local array sorted
    
    renderRecipes(); // Re-render the full list
    recipeForm.reset();
    renderFormRatingStars(0);
    editingRecipeId = null;
    formSectionHeading.textContent = 'Add New Recipe';
    formSubmitBtn.textContent = 'Add Recipe';
    cancelEditBtn.classList.add('hidden');
    showingAllSuggestions = false;
    handleSuggestRecipe();
  } catch (error) {
    console.error("Error adding recipe to Firestore:", error);
    alert('Failed to add recipe. Please try again.');
  }
}

async function updateRecipeInFirestore(recipeId: string, updatedData: Partial<Recipe>): Promise<void> {
  if (!db) {
    alert('Error: Database not connected. Cannot update recipe.');
    return;
  }
  try {
    await db.collection(FIRESTORE_COLLECTION_NAME).doc(recipeId).update(updatedData);
    
    const recipeIndex = recipes.findIndex(r => r.id === recipeId);
    if (recipeIndex > -1) {
      recipes[recipeIndex] = { ...recipes[recipeIndex], ...updatedData };
      recipes.sort((a, b) => a.name.localeCompare(b.name)); 
    }
    
    renderRecipes(); // Re-render the full list
    // If it was an edit operation from the form:
    if (editingRecipeId === recipeId && formSectionHeading.textContent === 'Edit Recipe') {
        recipeForm.reset();
        renderFormRatingStars(0);
        editingRecipeId = null;
        formSectionHeading.textContent = 'Add New Recipe';
        formSubmitBtn.textContent = 'Add Recipe';
        cancelEditBtn.classList.add('hidden');
    }
    showingAllSuggestions = false;
    handleSuggestRecipe();

  } catch (error) {
    console.error("Error updating recipe in Firestore:", error);
    alert('Failed to update recipe. Please try again.');
  }
}

async function deleteRecipeFromFirestore(recipeId: string): Promise<void> {
  if (!db) {
    alert('Error: Database not connected. Cannot delete recipe.');
    return;
  }
  if (confirm('Are you sure you want to delete this recipe?')) {
    try {
      await db.collection(FIRESTORE_COLLECTION_NAME).doc(recipeId).delete();
      recipes = recipes.filter(r => r.id !== recipeId); // Update local array
      
      renderRecipes();
      if (editingRecipeId === recipeId) {
          recipeForm.reset();
          renderFormRatingStars(0);
          editingRecipeId = null;
          formSectionHeading.textContent = 'Add New Recipe';
          formSubmitBtn.textContent = 'Add Recipe';
          cancelEditBtn.classList.add('hidden');
      }
      showingAllSuggestions = false;
      handleSuggestRecipe();
    } catch (error) {
      console.error("Error deleting recipe from Firestore:", error);
      alert('Failed to delete recipe. Please try again.');
    }
  }
}

// Star Rating Input Functions
function renderFormRatingStars(rating: number): void {
  currentFormRating = rating;
  const stars = recipeRatingStarsContainer.querySelectorAll('.star-input');
  stars.forEach(star => {
    const starValue = parseInt(star.getAttribute('data-value') || '0', 10);
    if (starValue <= rating) {
      star.textContent = FULL_STAR;
      star.classList.add('filled');
      star.setAttribute('aria-checked', 'true');
    } else {
      star.textContent = EMPTY_STAR;
      star.classList.remove('filled');
      star.setAttribute('aria-checked', 'false');
    }
  });
}

function setupStarRatingInput(): void {
  recipeRatingStarsContainer.addEventListener('click', (event) => {
    const target = event.target;
    if (target.classList.contains('star-input')) {
      const value = parseInt(target.getAttribute('data-value') || '0', 10);
      renderFormRatingStars(value);
    }
  });

  recipeRatingStarsContainer.addEventListener('mouseover', (event) => {
    const target = event.target;
    if (target.classList.contains('star-input')) {
      const hoverValue = parseInt(target.getAttribute('data-value') || '0', 10);
      const stars = recipeRatingStarsContainer.querySelectorAll('.star-input');
      stars.forEach(star => {
        const starValue = parseInt(star.getAttribute('data-value') || '0', 10);
        star.classList.toggle('hover-filled', starValue <= hoverValue && starValue > currentFormRating);
         if (starValue <= hoverValue) {
            star.textContent = FULL_STAR;
        } else {
            star.textContent = EMPTY_STAR;
        }
      });
    }
  });

  recipeRatingStarsContainer.addEventListener('mouseout', () => {
    renderFormRatingStars(currentFormRating);
  });
  
  recipeRatingStarsContainer.addEventListener('keydown', (event) => {
    const target = event.target;
    if (target.classList.contains('star-input') && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        const value = parseInt(target.getAttribute('data-value') || '0', 10);
        renderFormRatingStars(value);
    }
  });
}


// Recipe Rendering and Management
function renderRecipes(): void {
  if (!recipesContainer) return;
  if (recipes.length === 0) {
    recipesContainer.innerHTML = '<p>No recipes added yet. Add one above!</p>';
    return;
  }

  recipesContainer.innerHTML = ''; 
  recipes.forEach(recipe => {
    const card = document.createElement('div');
    card.className = 'recipe-card';
    card.dataset.recipeId = recipe.id;

    const detailsVisibleLocalStorageKey = `recipeDetailsVisible_${recipe.id}`;
    const isDetailsVisibleFromStorage = localStorage.getItem(detailsVisibleLocalStorageKey) === 'true';
    card.dataset.detailsVisible = isDetailsVisibleFromStorage ? 'true' : 'false';


    card.innerHTML = `
      <h3>
        <span class="recipe-name-display">${escapeHTML(recipe.name)}</span>
        ${displayStars(recipe.rating)}
        <button class="toggle-details" data-recipe-id="${recipe.id}" aria-expanded="${isDetailsVisibleFromStorage}">${isDetailsVisibleFromStorage ? 'Hide' : 'Show'} Details</button>
      </h3>
      <div class="last-eaten-management">
        <label for="last-eaten-${recipe.id}" class="visually-hidden">Last eaten date for ${escapeHTML(recipe.name)}</label>
        <input type="date" id="last-eaten-${recipe.id}" class="recipe-last-eaten-date-input" data-recipe-id="${recipe.id}" 
               value="${recipe.lastEatenDate || ''}" max="${getCurrentDateString()}">
        <span class="last-eaten-context-text">${calculateDaysAgo(recipe.lastEatenDate)}</span>
      </div>
      <div class="recipe-card-details ${isDetailsVisibleFromStorage ? '' : 'hidden'}">
        <h4>Ingredients:</h4>
        <p>${recipe.ingredients ? escapeHTML(recipe.ingredients).replace(/\n/g, '<br>') : 'Not specified'}</p>
        <h4>Instructions:</h4>
        <p>${recipe.instructions ? escapeHTML(recipe.instructions).replace(/\n/g, '<br>') : 'Not specified'}</p>
      </div>
      <div class="recipe-actions">
        <button class="edit-recipe-btn" data-recipe-id="${recipe.id}">Edit</button>
        <button class="delete-recipe-btn" data-recipe-id="${recipe.id}">Delete</button>
        <button class="log-meal-btn" data-recipe-id="${recipe.id}">I Ate This Today!</button>
      </div>
    `;
    recipesContainer.appendChild(card);
  });
}

function handleFormSubmit(event: Event): void {
  event.preventDefault();
  const name = recipeNameInput.value.trim();
  const ingredients = recipeIngredientsInput.value.trim();
  const instructions = recipeInstructionsInput.value.trim();

  if (!name) {
    alert('Recipe name is required.');
    return;
  }

  const recipeData = { 
    name, 
    ingredients, 
    instructions, 
    rating: currentFormRating,
  };

  if (editingRecipeId) {
    const existingRecipe = recipes.find(r => r.id === editingRecipeId);
    if (existingRecipe) {
        const updatedFullData: Partial<Recipe> = {
            name,
            ingredients,
            instructions,
            rating: currentFormRating
        };
        updateRecipeInFirestore(editingRecipeId, updatedFullData);
    }
  } else {
    const newRecipeData: Omit<Recipe, 'id'> = {
        name,
        ingredients,
        instructions,
        rating: currentFormRating,
        lastEatenDate: null, 
    };
    addRecipeToFirestore(newRecipeData);
  }
}

function editRecipe(recipeId: string): void {
  const recipe = recipes.find(r => r.id === recipeId);
  if (recipe) {
    editingRecipeId = recipe.id;
    recipeNameInput.value = recipe.name;
    recipeIngredientsInput.value = recipe.ingredients;
    recipeInstructionsInput.value = recipe.instructions;
    renderFormRatingStars(recipe.rating);
    
    formSectionHeading.textContent = 'Edit Recipe';
    formSubmitBtn.textContent = 'Save Changes';
    cancelEditBtn.classList.remove('hidden');
    recipeNameInput.focus();
    window.scrollTo({ top: recipeForm.offsetTop - 20, behavior: 'smooth' });
  }
}


function handleRecipeAction(event: Event): void {
  const eventTarget = event.target;
  if (!(eventTarget instanceof HTMLElement)) return;
  
  const target: HTMLElement = eventTarget;
  const recipeId = target.dataset.recipeId;

  if (!recipeId) return;

  if (target.classList.contains('edit-recipe-btn')) {
    editRecipe(recipeId);
  } else if (target.classList.contains('delete-recipe-btn')) {
    deleteRecipeFromFirestore(recipeId);
  } else if (target.classList.contains('log-meal-btn')) {
    const recipe = recipes.find(r => r.id === recipeId);
    if (recipe) {
        updateRecipeInFirestore(recipeId, { lastEatenDate: getCurrentDateString() });
    }
  } else if (target.classList.contains('toggle-details')) {
    const cardElement = target.closest('.recipe-card');
    if (cardElement instanceof HTMLElement) {
      const details = cardElement.querySelector('.recipe-card-details');
      if (details) {
          const isCurrentlyHidden = details.classList.toggle('hidden');
          const detailsVisibleLocalStorageKey = `recipeDetailsVisible_${recipeId}`;
          target.textContent = isCurrentlyHidden ? 'Show Details' : 'Hide Details';
          target.setAttribute('aria-expanded', isCurrentlyHidden ? 'false' : 'true');
          cardElement.dataset.detailsVisible = isCurrentlyHidden ? 'false' : 'true';
          localStorage.setItem(detailsVisibleLocalStorageKey, isCurrentlyHidden ? 'false' : 'true');
      }
    }
  }
}

function handleSuggestRecipe(): void {
  if (!suggestedRecipeDisplay) return;
  if (recipes.length === 0) {
    suggestedRecipeDisplay.innerHTML = '<p>No recipes available to suggest. Add some recipes first!</p>';
    return;
  }

  const recipesWithMetadata = recipes.map(recipe => {
    let daysSinceEaten = Infinity;
    if (recipe.lastEatenDate) {
      const today = new Date();
      const eatenDate = new Date(recipe.lastEatenDate);
      today.setHours(0, 0, 0, 0);
      eatenDate.setHours(0, 0, 0, 0);
      daysSinceEaten = Math.floor((today.getTime() - eatenDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysSinceEaten < 0) daysSinceEaten = Infinity; 
    }
    return { ...recipe, daysSinceEaten };
  });

  recipesWithMetadata.sort((a, b) => {
    if (a.daysSinceEaten !== b.daysSinceEaten) {
      return b.daysSinceEaten - a.daysSinceEaten; 
    }
    if (a.rating !== b.rating) {
      return b.rating - a.rating; 
    }
    return a.name.localeCompare(b.name);
  });

  const numToShow = showingAllSuggestions ? recipesWithMetadata.length : INITIAL_SUGGESTIONS_COUNT;
  const suggestionsToShow = recipesWithMetadata.slice(0, numToShow);

  if (suggestionsToShow.length === 0) {
      suggestedRecipeDisplay.innerHTML = '<p>No suitable suggestions found at the moment.</p>';
      return;
  }

  let html = '<h3>Recipe Suggestions:</h3><ul class="suggestion-list">';
  suggestionsToShow.forEach(recipe => {
    html += `<li class="suggestion-item" data-recipe-id="${recipe.id}" tabindex="0" role="button" 
                 aria-label="Scroll to and show details for ${escapeHTML(recipe.name)}">
                ${escapeHTML(recipe.name)} 
                ${displayStars(recipe.rating)}
                <span class="suggestion-eaten-status">${calculateDaysAgoForSuggestion(recipe.lastEatenDate)}</span>
             </li>`;
  });
  html += '</ul>';

  if (!showingAllSuggestions && recipesWithMetadata.length > INITIAL_SUGGESTIONS_COUNT) {
    const remainingCount = recipesWithMetadata.length - INITIAL_SUGGESTIONS_COUNT;
    html += `<button id="show-more-suggestions-btn">Show ${remainingCount} More Suggestion${remainingCount > 1 ? 's' : ''}</button>`;
  }

  suggestedRecipeDisplay.innerHTML = html;

  if (!showingAllSuggestions && recipesWithMetadata.length > INITIAL_SUGGESTIONS_COUNT) {
    const showMoreBtn = document.getElementById('show-more-suggestions-btn');
    if (showMoreBtn) {
      showMoreBtn.addEventListener('click', () => {
        showingAllSuggestions = true;
        handleSuggestRecipe(); 
      });
    }
  }
}


// Initialization
async function initializeApp(): Promise<void> {
  if (!db) {
    if(suggestRecipeBtn) suggestRecipeBtn.disabled = true;
    if(formSubmitBtn) formSubmitBtn.disabled = true;
    return;
  }
  await loadRecipesFromFirestore(); 
  setupStarRatingInput();
  renderFormRatingStars(0);

  if(recipeForm) recipeForm.addEventListener('submit', handleFormSubmit);
  
  if(recipesContainer) {
    recipesContainer.addEventListener('click', handleRecipeAction);
    recipesContainer.addEventListener('change', (event) => {
        const eventTarget = event.target;
        if (!(eventTarget instanceof HTMLInputElement)) return;
        
        const targetInput: HTMLInputElement = eventTarget;
        if (targetInput.classList.contains('recipe-last-eaten-date-input')) {
            const recipeId = targetInput.dataset.recipeId;
            if (!recipeId) return;
            const recipe = recipes.find(r => r.id === recipeId);
            if (recipe) {
                const newDate = targetInput.value;
                updateRecipeInFirestore(recipeId, { lastEatenDate: newDate ? newDate : null });
            }
        }
    });
  }

  if(suggestRecipeBtn) {
    suggestRecipeBtn.addEventListener('click', () => {
        showingAllSuggestions = false; 
        handleSuggestRecipe();
    });
  }
  
  if (suggestedRecipeDisplay && recipesContainer) {
    const handleSuggestionInteraction = (recipeId: string) => {
      const recipeCard = recipesContainer.querySelector(`.recipe-card[data-recipe-id="${recipeId}"]`);
      if (recipeCard) {
        recipeCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        const details = recipeCard.querySelector('.recipe-card-details');
        const toggleButton = recipeCard.querySelector('.toggle-details');
        
        if (details && toggleButton && details.classList.contains('hidden')) {
            toggleButton.click(); // This will trigger the existing logic in handleRecipeAction
        }
      }
    };

    suggestedRecipeDisplay.addEventListener('click', (event) => {
      const target = event.target;
      const suggestionItem = target.closest('.suggestion-item');
      if (suggestionItem instanceof HTMLElement && suggestionItem.dataset.recipeId) {
        handleSuggestionInteraction(suggestionItem.dataset.recipeId);
      }
    });

    suggestedRecipeDisplay.addEventListener('keydown', (event) => {
      const target = event.target;
      if (target.classList.contains('suggestion-item') && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        if (target.dataset.recipeId) {
          handleSuggestionInteraction(target.dataset.recipeId);
        }
      }
    });
  }


  if(cancelEditBtn) {
    cancelEditBtn.addEventListener('click', () => {
        editingRecipeId = null;
        recipeForm.reset();
        renderFormRatingStars(0);
        formSectionHeading.textContent = 'Add New Recipe';
        formSubmitBtn.textContent = 'Add Recipe';
        cancelEditBtn.classList.add('hidden');
    });
  }
}

// Start the app
initializeApp().catch(err => {
  console.error("Failed to initialize application:", err);
  if(recipesContainer) recipesContainer.innerHTML = '<p style="color:red;">Application failed to initialize. See console for details.</p>';
});
