import { Component, AfterViewInit, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../../auth.service';

@Component({
  selector: 'app-about-journal-watch',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './about-journal-watch.html',
  styleUrl: './about-journal-watch.scss',
})
export class AboutJournalWatch implements AfterViewInit {
  protected authService = inject(AuthService);

  ngAfterViewInit(): void {
    window.scrollTo({ top: 0, behavior: 'instant' });
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );

    document.querySelectorAll('.animate').forEach(el => observer.observe(el));
  }
}
